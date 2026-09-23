/** §3.4 — how far one read of a PDF's text layer may go */
export type PdfReadBudget = {
  /** the read, and any wait for its turn to read, ends once this aborts, keeping every page read whole by then */
  readonly deadline: AbortSignal;
  /** the read stops at the page boundary where the pages read hold this many characters; one page longer alone is cut to it */
  readonly maxChars: number;
};

/** §3.4 — what ended a read before its last page: its text past the ceiling, its deadline, or its memory past the cap */
export type PdfReadStop = 'char-limit' | 'deadline' | 'memory-limit';

/** a PDF's text layer as far as one read went, from its first page on */
export type PdfText = {
  readonly pageCount: number;
  /** each page's text in page order; fewer than `pageCount` when the read stopped early */
  readonly pages: readonly string[];
  /** absent when every page was read */
  readonly stoppedBy?: PdfReadStop;
};

/**
 * why nothing of a PDF could be read: it asks for a password, it does not parse, its deadline or
 * its memory ran out before its first page, or every read the deployment runs at once stayed
 * taken until its deadline
 */
export type PdfUnreadableReason = 'busy' | 'encrypted' | 'malformed' | Exclude<PdfReadStop, 'char-limit'>;
