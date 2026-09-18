import { z } from 'zod';

/**
 * The dialog's state as the click that opened it set it: the decider's username, since a submission
 * carries only a user id, and a signature over that pending row and that username, since the state
 * reaches the decider's client and comes back as whatever it says (§6.4).
 */
export const $DialogState = z.string().transform((raw, ctx) => {
  try {
    return z.object({ byUsername: z.string().min(1), signature: z.string().min(1) }).parse(JSON.parse(raw));
  } catch {
    ctx.addIssue({ code: 'custom', message: 'state must be a JSON envelope of byUsername and signature' });
    return z.NEVER;
  }
});
