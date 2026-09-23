import { z } from 'zod';

/** what the reader is told on its command line, as one JSON argument */
export type $UnpdfReaderOrders = z.infer<typeof $UnpdfReaderOrders>;
export const $UnpdfReaderOrders = z.object({
  maxChars: z.number().int().positive(),
  /** given where the parent cannot read the reader's memory, so the reader kills itself past the cap instead */
  watchOwnMemory: z
    .object({ capBytes: z.number().int().positive(), intervalMs: z.number().int().positive() })
    .optional()
});

/** one line the reader writes to its standard output: a page read, or how the read ended */
export type $UnpdfReaderMessage = z.infer<typeof $UnpdfReaderMessage>;
export const $UnpdfReaderMessage = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('page'), pageCount: z.number().int().positive(), text: z.string() }),
  z.object({
    kind: z.literal('done'),
    pageCount: z.number().int().nonnegative(),
    stoppedBy: z.literal('char-limit').optional()
  }),
  z.object({ kind: z.literal('unreadable'), reason: z.enum(['encrypted', 'malformed']) })
]);
