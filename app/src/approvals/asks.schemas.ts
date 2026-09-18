import { z } from 'zod';

import { $$CamelCased } from '@/core/core.schemas.ts';

import { $DialogState } from './decisions/decisions.schemas.ts';

/**
 * What Mattermost POSTs when a human clicks one of a question's buttons: an offered answer, whose
 * label the prompt baked into the button's own context, or — with no answer — the button that opens
 * the free-text dialog.
 */
export type $MattermostAskActionBody = z.infer<typeof $MattermostAskActionBody>;
export const $MattermostAskActionBody = $$CamelCased(
  z.object({
    context: z.object({
      answerText: z.string().min(1).optional(),
      askId: z.string().min(1),
      /** minted over this ask and answer when the prompt was rendered; verified before the service is reached (§6.4) */
      signature: z.string().min(1)
    }),
    triggerId: z.string().optional(),
    userId: z.string().min(1)
  })
);

/** what Mattermost POSTs when the free-text dialog is submitted; the ask id is the dialog's callback id */
export type $MattermostAskAnswerDialogBody = z.infer<typeof $MattermostAskAnswerDialogBody>;
export const $MattermostAskAnswerDialogBody = $$CamelCased(
  z.object({
    callbackId: z.string().min(1),
    cancelled: z.boolean().optional(),
    state: $DialogState,
    submission: z.object({ answer: z.string() }),
    userId: z.string().min(1)
  })
);
