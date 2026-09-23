import type { Result } from '@collegium/core/utils';

import type { PdfReadBudget, PdfText, PdfUnreadableReason } from './pdf.types.ts';

/**
 * The seam in front of the PDF parser: a document's text layer, page by page from the first, as far
 * as the budget allows. Only the text layer — a scanned page is an image, and nothing here reads
 * one (§3.4).
 */
export abstract class PdfTextExtractor {
  abstract extract(bytes: Uint8Array, budget: PdfReadBudget): Promise<Result<PdfText, PdfUnreadableReason>>;
}
