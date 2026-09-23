import { spawn } from 'node:child_process';
import type { ChildProcessByStdio } from 'node:child_process';
import * as path from 'node:path';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import { Result } from '@collegium/core/utils';
import { match } from 'ts-pattern';

import { $$JSONEncoded } from '@/core/core.schemas.ts';

import { readResidentMemoryBytes } from './resident-memory.utils.ts';
import { $UnpdfReaderMessage } from './unpdf-reader.schemas.ts';

import type { PdfReadBudget, PdfReadStop, PdfText, PdfUnreadableReason } from '../pdf.types.ts';
import type { $UnpdfReaderOrders } from './unpdf-reader.schemas.ts';

/** the reader's entry beside this file, with this file's own extension: the source in development and tests, the build in the image */
const READER_ENTRY = fileURLToPath(
  new URL(`./unpdf-reader.child${path.extname(import.meta.filename)}`, import.meta.url)
);

/** Linux alone lets one process read another's memory without privilege; elsewhere the reader is told to watch its own */
const IS_WATCHED_FROM_OUTSIDE = process.platform === 'linux';

const MEMORY_PROBE_INTERVAL_MS = 25;

/** how much of the reader's standard error a fault carries into the error it raises */
const STDERR_KEPT_CHARS = 2_000;

const $UnpdfReaderLine = $$JSONEncoded($UnpdfReaderMessage);

type ReaderKill = Exclude<PdfReadStop, 'char-limit'>;

type ReaderEnding = Extract<$UnpdfReaderMessage, { kind: 'done' | 'unreadable' }> | { by: ReaderKill; kind: 'killed' };

type UnpdfReaderResult = Result<PdfText, Exclude<PdfUnreadableReason, 'busy'>>;

/**
 * One child process reading one PDF (§3.4). It is killed past the memory cap or at the deadline,
 * and either way the pages it wrote before then are kept. The result settles only once the process
 * has exited, so its memory is back before the caller counts the read as over.
 */
export class UnpdfReaderProcess {
  readonly result: Promise<UnpdfReaderResult>;

  private readonly child: ChildProcessByStdio<Writable, Readable, Readable>;
  private ending?: ReaderEnding;
  private failure?: Error;
  private pageCount = 0;
  private readonly pages: string[] = [];
  private stderr = '';

  constructor(bytes: Uint8Array, budget: PdfReadBudget, memoryCapBytes: number) {
    const orders: $UnpdfReaderOrders = {
      maxChars: budget.maxChars,
      ...(!IS_WATCHED_FROM_OUTSIDE && {
        watchOwnMemory: { capBytes: memoryCapBytes, intervalMs: MEMORY_PROBE_INTERVAL_MS }
      })
    };
    const heapLimitMegabytes = Math.floor(memoryCapBytes / 2 ** 20);
    // no environment: the process that parses untrusted bytes holds none of the server's secrets
    this.child = spawn(
      process.execPath,
      [`--max-old-space-size=${heapLimitMegabytes}`, READER_ENTRY, JSON.stringify(orders)],
      { env: {}, stdio: ['pipe', 'pipe', 'pipe'] }
    );
    this.result = this.superviseUntilExit(budget.deadline, memoryCapBytes);
    // a reader killed before it took all its input breaks the pipe, and an unhandled 'error' would take the server
    this.child.stdin.on('error', () => undefined);
    this.child.stdin.end(bytes);
    this.child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      this.stderr += chunk.slice(0, Math.max(0, STDERR_KEPT_CHARS - this.stderr.length));
    });
    createInterface({ input: this.child.stdout }).on('line', (line) => this.receive(line));
  }

  /** ends the read as its deadline would, keeping the pages already written */
  stop(): void {
    this.kill('deadline');
  }

  /**
   * An exit the reader did not announce and the server did not cause: a kill signal is the kernel's
   * OOM killer, an abort is V8 past its heap limit, and off Linux either may be the reader's own
   * watch — memory, each of them. Anything else is a fault in the reader.
   */
  private explainExit(signal: NodeJS.Signals | null): ReaderEnding | undefined {
    return signal === 'SIGKILL' || signal === 'SIGABRT' ? { by: 'memory-limit', kind: 'killed' } : undefined;
  }

  private fail(error: Error): void {
    this.failure ??= error;
    this.child.kill('SIGKILL');
  }

  private kill(by: ReaderKill): void {
    this.ending ??= { by, kind: 'killed' };
    this.child.kill('SIGKILL');
  }

  private async probeMemory(pid: number, memoryCapBytes: number): Promise<void> {
    try {
      const residentBytes = await readResidentMemoryBytes(pid);
      if (residentBytes !== undefined && residentBytes > memoryCapBytes) {
        this.kill('memory-limit');
      }
    } catch (error) {
      this.fail(new Error('could not read the memory of the process reading a PDF', { cause: error }));
    }
  }

  private receive(line: string): void {
    const message = $UnpdfReaderLine.safeParse(line);
    if (!message.success) {
      this.fail(new Error(`the process reading a PDF wrote a line outside its protocol: ${line.slice(0, 200)}`));
      return;
    }
    match(message.data)
      .with({ kind: 'page' }, ({ pageCount, text }) => {
        this.pageCount = pageCount;
        this.pages.push(text);
      })
      .with({ kind: 'done' }, { kind: 'unreadable' }, (ending) => {
        // the reader's own word outranks a kill whose signal crossed its last lines in the pipe
        this.ending = ending;
        this.child.kill('SIGKILL');
      })
      .exhaustive();
  }

  private superviseUntilExit(deadline: AbortSignal, memoryCapBytes: number): Promise<UnpdfReaderResult> {
    const onDeadline = (): void => this.kill('deadline');
    if (deadline.aborted) {
      onDeadline();
    } else {
      deadline.addEventListener('abort', onDeadline, { once: true });
    }
    const pid = this.child.pid;
    const memoryWatch =
      IS_WATCHED_FROM_OUTSIDE && pid !== undefined
        ? setInterval(() => void this.probeMemory(pid, memoryCapBytes), MEMORY_PROBE_INTERVAL_MS)
        : undefined;
    return new Promise((resolve, reject) => {
      const release = (): void => {
        clearInterval(memoryWatch);
        deadline.removeEventListener('abort', onDeadline);
      };
      this.child.on('error', (error) => {
        if (pid === undefined) {
          release();
          reject(error);
        }
      });
      this.child.once('close', (code, signal) => {
        release();
        const ending = this.ending ?? this.explainExit(signal);
        if (this.failure !== undefined || ending === undefined) {
          const exit = signal ?? `code ${code}`;
          reject(
            this.failure ?? new Error(`the process reading a PDF exited with ${exit} and no result: ${this.stderr}`)
          );
          return;
        }
        resolve(this.toResult(ending));
      });
    });
  }

  private toResult(ending: ReaderEnding): UnpdfReaderResult {
    return match(ending)
      .returnType<UnpdfReaderResult>()
      .with({ kind: 'done' }, ({ pageCount, stoppedBy }) => {
        return Result.ok({ pageCount, pages: this.pages, ...(stoppedBy && { stoppedBy }) });
      })
      .with({ kind: 'unreadable' }, ({ reason }) => Result.err(reason))
      .with({ kind: 'killed' }, ({ by }) => {
        return this.pages.length === 0
          ? Result.err(by)
          : Result.ok({ pageCount: this.pageCount, pages: this.pages, stoppedBy: by });
      })
      .exhaustive();
  }
}
