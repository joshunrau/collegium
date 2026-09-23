import { Result } from '@collegium/core/utils';
import type { OnApplicationShutdown } from '@nestjs/common';

import { PdfTextExtractor } from '../pdf-text.extractor.ts';
import { UnpdfReaderProcess } from './unpdf-reader.process.ts';

import type { PdfReadBudget, PdfText, PdfUnreadableReason } from '../pdf.types.ts';

type UnpdfReadLimits = {
  /** the resident memory one reading process may reach before it is killed */
  readonly memoryCapBytes: number;
  /** how many reading processes run at once; a read beyond them waits for one to exit */
  readonly readsAtOnce: number;
};

/**
 * PDF.js, as unpdf packages it for server runtimes, run in a child process per document (§3.4). A
 * parse that inflates a stream to gigabytes, or never yields, is killed with its process, so the
 * server spends no more on one PDF than the limits allow, and no more on all of them than the
 * limits allow each times the reads at once.
 */
export class UnpdfTextExtractor extends PdfTextExtractor implements OnApplicationShutdown {
  private freeSlots: number;
  private readonly readers = new Set<UnpdfReaderProcess>();
  private readonly waiting: (() => void)[] = [];

  constructor(private readonly limits: UnpdfReadLimits) {
    super();
    this.freeSlots = limits.readsAtOnce;
  }

  async extract(bytes: Uint8Array, budget: PdfReadBudget): Promise<Result<PdfText, PdfUnreadableReason>> {
    if (!(await this.takeSlot(budget.deadline))) {
      return Result.err('busy');
    }
    try {
      const reader = new UnpdfReaderProcess(bytes, budget, this.limits.memoryCapBytes);
      this.readers.add(reader);
      try {
        return await reader.result;
      } finally {
        this.readers.delete(reader);
      }
    } finally {
      this.releaseSlot();
    }
  }

  onApplicationShutdown(): void {
    for (const reader of this.readers) {
      reader.stop();
    }
  }

  private releaseSlot(): void {
    const next = this.waiting.shift();
    if (next) {
      next();
    } else {
      this.freeSlots += 1;
    }
  }

  /** resolves once a slot is held, handed over by the read that frees it, or false if the deadline passes first */
  private takeSlot(deadline: AbortSignal): Promise<boolean> {
    if (this.freeSlots > 0) {
      this.freeSlots -= 1;
      return Promise.resolve(true);
    }
    if (deadline.aborted) {
      return Promise.resolve(false);
    }
    return new Promise((resolve) => {
      const onDeadline = (): void => {
        this.waiting.splice(this.waiting.indexOf(grant), 1);
        resolve(false);
      };
      const grant = (): void => {
        deadline.removeEventListener('abort', onDeadline);
        resolve(true);
      };
      deadline.addEventListener('abort', onDeadline, { once: true });
      this.waiting.push(grant);
    });
  }
}
