import { z } from 'zod';

import { $$CamelCased } from '@/core/core.schemas.ts';

const $SignedClearingState = z.object({
  byUsername: z.string().min(1),
  channelId: z.string().min(1),
  issuedAt: z.iso.datetime(),
  memories: z.boolean(),
  signature: z.string().min(1)
});

/**
 * The dialog's state as the command set it, signed: it reaches the human's client and comes back
 * as whatever it says (§6.4), so every field acted on is verified against the signature first.
 */
export const $ClearingDialogState = z.string().transform((raw, ctx) => {
  try {
    return $SignedClearingState.parse(JSON.parse(raw));
  } catch {
    ctx.addIssue({ code: 'custom', message: 'state must be a JSON envelope of the clear request and its signature' });
    return z.NEVER;
  }
});

export type $ClearingDialogSubmissionBody = z.infer<typeof $ClearingDialogSubmissionBody>;
export const $ClearingDialogSubmissionBody = $$CamelCased(
  z.object({
    callbackId: z.string().min(1),
    cancelled: z.boolean().optional(),
    state: $ClearingDialogState,
    userId: z.string().min(1)
  })
);
