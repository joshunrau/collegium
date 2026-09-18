import { z } from 'zod';

/** what the Mattermost plugin forwards for one execution: the text after `/collegium`, and who ran it where */
export type $CommandRequestBody = z.infer<typeof $CommandRequestBody>;
export const $CommandRequestBody = z.object({
  channel_id: z.string().min(1),
  text: z.string().prefault(''),
  /** §3.7 — presence is authority, and presence is checked against a user id, never a display name */
  user_id: z.string().min(1),
  user_name: z.string().min(1)
});
