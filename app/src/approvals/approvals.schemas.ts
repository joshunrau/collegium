import { z } from 'zod';

import { $$CamelCased } from '@/core/core.schemas.ts';

/**
 * The dialog's state as the click that opened it set it: the decider's username, since a submission
 * carries only a user id, and a signature over this approval and that username, since the state
 * reaches the decider's client and comes back as whatever it says (§6.4).
 */
const $DialogState = z.string().transform((raw, ctx) => {
  try {
    return z.object({ byUsername: z.string().min(1), signature: z.string().min(1) }).parse(JSON.parse(raw));
  } catch {
    ctx.addIssue({ code: 'custom', message: 'state must be a JSON envelope of byUsername and signature' });
    return z.NEVER;
  }
});

/** what Mattermost POSTs when a human clicks one of the prompt's buttons */
export type $MattermostActionBody = z.infer<typeof $MattermostActionBody>;
export const $MattermostActionBody = $$CamelCased(
  z.object({
    context: z.object({
      action: z.enum(['approve', 'deny', 'deny-with-reason']),
      approvalId: z.string().min(1),
      /** minted over this approval and action when the prompt was rendered; verified before the service is reached (§6.4) */
      signature: z.string().min(1)
    }),
    triggerId: z.string().optional(),
    userId: z.string().min(1),
    userName: z.string().min(1)
  })
);

/** what Mattermost POSTs when the deny-with-reason dialog is submitted; the approval id is the dialog's callback id */
export type $MattermostDialogSubmissionBody = z.infer<typeof $MattermostDialogSubmissionBody>;
export const $MattermostDialogSubmissionBody = $$CamelCased(
  z.object({
    callbackId: z.string().min(1),
    cancelled: z.boolean().optional(),
    state: $DialogState,
    submission: z.object({ reason: z.string() }),
    userId: z.string().min(1)
  })
);
