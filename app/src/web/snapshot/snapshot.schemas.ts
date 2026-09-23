import { z } from 'zod';

import type { SnapshotCapture } from './snapshot.types.ts';

const $FormElementBase = z.object({
  isHidden: z.boolean(),
  label: z.string(),
  ref: z.string(),
  value: z.string()
});

/** parsed although the script is ours: it runs in the browser's process, against a document the page wrote */
export type $SnapshotCapture = z.infer<typeof $SnapshotCapture>;
export const $SnapshotCapture = z.object({
  formElements: z.array(
    z.discriminatedUnion('kind', [
      $FormElementBase.extend({ kind: z.literal('button') }),
      $FormElementBase.extend({ kind: z.literal('input'), type: z.string() }),
      $FormElementBase.extend({ kind: z.literal('select'), options: z.array(z.string()) }),
      $FormElementBase.extend({ kind: z.literal('textarea') })
    ])
  ),
  html: z.string(),
  nextRefIndex: z.int().nonnegative()
}) satisfies z.ZodType<SnapshotCapture>;
