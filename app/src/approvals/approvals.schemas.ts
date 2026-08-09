import { z } from 'zod';

import { $$CamelCased } from '@/core/core.schemas.ts';

/** what Mattermost POSTs when a human clicks one of the prompt's buttons */
export type $MattermostActionBody = z.infer<typeof $MattermostActionBody>;
export const $MattermostActionBody = $$CamelCased(
  z.object({
    context: z.object({
      action: z.enum(['approve', 'deny', 'deny-with-reason']),
      approvalId: z.string().min(1)
    }),
    triggerId: z.string().optional(),
    userId: z.string().min(1),
    userName: z.string().min(1)
  })
);

/**
 * What Mattermost POSTs when the deny-with-reason dialog is submitted. A submission carries no
 * username — only user_id — so the decider's username rides the dialog's own state field, set
 * when the click opened it.
 */
export type $MattermostDialogSubmissionBody = z.infer<typeof $MattermostDialogSubmissionBody>;
export const $MattermostDialogSubmissionBody = $$CamelCased(
  z.object({
    callbackId: z.string().min(1),
    cancelled: z.boolean().optional(),
    state: z.string().min(1),
    submission: z.object({ reason: z.string() }),
    userId: z.string().min(1)
  })
);
