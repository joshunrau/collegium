/** §3.4 — how far one read of a PDF's text layer may go before it stops at a page boundary */
export type PdfReadBudget = {
  /** the read stops once this aborts; the first page is read regardless */
  readonly deadline: AbortSignal;
  /** the read stops once the pages read hold this many characters */
  readonly maxChars: number;
};

/** a PDF's text layer as far as one read went, from its first page on */
export type PdfText = {
  readonly pageCount: number;
  /** each page's text in page order; fewer than `pageCount` when the read stopped early */
  readonly pages: readonly string[];
  /** absent when every page was read */
  readonly stoppedBy?: 'char-limit' | 'deadline';
};

/** why nothing of a PDF could be read: it asks for a password, or it does not parse */
export type PdfUnreadableReason = 'encrypted' | 'malformed';
