import { spawn } from 'node:child_process';
import type { Readable } from 'node:stream';

import { Result, toErrorMessage } from '@collegium/core/utils';
import { Injectable } from '@nestjs/common';

import type { CapturedProcess, ShellSpawnFailure } from '../shell.types.ts';

/**
 * The seam over `child_process` — the OS is the vendor. It launches a process, captures both
 * streams, and resolves on close. It imposes no deadline of its own: `timeout(1)` owns the deadline
 * as the dedicated user, because a Node-side kill of a process running as another user would EPERM.
 */
@Injectable()
export class ProcessRunner {
  /** past the limit a chunk is counted, not kept: a string grown for the whole deadline would throw in V8 and take the process */
  private static capture(stream: Readable, limitChars: number): () => { droppedChars: number; text: string } {
    let text = '';
    let droppedChars = 0;
    stream.setEncoding('utf8').on('data', (chunk: string) => {
      const kept = chunk.slice(0, Math.max(0, limitChars - text.length));
      text += kept;
      droppedChars += chunk.length - kept.length;
    });
    return () => ({ droppedChars, text });
  }

  spawnCaptured(
    file: string,
    args: readonly string[],
    options: { captureLimitChars: number; cwd: string }
  ): Promise<Result<CapturedProcess, ShellSpawnFailure>> {
    return new Promise((resolve) => {
      const child = spawn(file, [...args], { cwd: options.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
      const readStdout = ProcessRunner.capture(child.stdout, options.captureLimitChars);
      const readStderr = ProcessRunner.capture(child.stderr, options.captureLimitChars);
      // a spawn failure (e.g. `sudo` missing) emits 'error' before 'close'; resolving once lets it win
      child.on('error', (error) => resolve(Result.err({ message: toErrorMessage(error) })));
      child.on('close', (code, signal) => {
        const stdout = readStdout();
        const stderr = readStderr();
        resolve(
          Result.ok({
            code,
            droppedChars: { stderr: stderr.droppedChars, stdout: stdout.droppedChars },
            signal,
            stderr: stderr.text,
            stdout: stdout.text
          })
        );
      });
    });
  }
}
