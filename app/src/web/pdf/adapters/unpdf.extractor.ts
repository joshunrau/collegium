import { setImmediate as yieldToEventLoop } from 'node:timers/promises';

import { Result } from '@collegium/core/utils';
import { Injectable } from '@nestjs/common';
import { getDocumentProxy } from 'unpdf';

import { PdfTextExtractor } from '../pdf-text.extractor.ts';

import type { PdfReadBudget, PdfText, PdfUnreadableReason } from '../pdf.types.ts';

type PdfDocument = Awaited<ReturnType<typeof getDocumentProxy>>;

/** PDF.js's own level for errors alone: its warnings about a damaged cross-reference table would reach the log */
const ERRORS_ONLY = 0;

/**
 * PDF.js, as unpdf packages it for server runtimes: in-process, with no worker file, no native
 * canvas and no fetch. It parses on this thread and yields to no timer while a page is parsed, so
 * the event loop is given a turn between pages, and the budget is what bounds the whole read.
 */
@Injectable()
export class UnpdfTextExtractor extends PdfTextExtractor {
  async extract(bytes: Uint8Array, budget: PdfReadBudget): Promise<Result<PdfText, PdfUnreadableReason>> {
    let document: PdfDocument;
    try {
      // a copy, because PDF.js detaches the buffer it is handed
      document = await getDocumentProxy(new Uint8Array(bytes), { verbosity: ERRORS_ONLY });
    } catch (error) {
      return Result.err(this.toUnreadableReason(error));
    }
    try {
      return Result.ok(await this.readPages(document, budget));
    } catch (error) {
      return Result.err(this.toUnreadableReason(error));
    } finally {
      await document.loadingTask.destroy();
    }
  }

  private async readPage(document: PdfDocument, pageNumber: number): Promise<string> {
    const content = await (await document.getPage(pageNumber)).getTextContent();
    return content.items.map((item) => ('str' in item ? `${item.str}${item.hasEOL ? '\n' : ''}` : '')).join('');
  }

  private async readPages(document: PdfDocument, budget: PdfReadBudget): Promise<PdfText> {
    const pageCount = document.numPages;
    const pages: string[] = [];
    let chars = 0;
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
      if (chars >= budget.maxChars) {
        return { pageCount, pages, stoppedBy: 'char-limit' };
      }
      if (pageNumber > 1 && budget.deadline.aborted) {
        return { pageCount, pages, stoppedBy: 'deadline' };
      }
      const text = await this.readPage(document, pageNumber);
      pages.push(text);
      chars += text.length;
      await yieldToEventLoop();
    }
    return { pageCount, pages };
  }

  private toUnreadableReason(error: unknown): PdfUnreadableReason {
    return error instanceof Error && error.name === 'PasswordException' ? 'encrypted' : 'malformed';
  }
}
