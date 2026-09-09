import { z } from 'zod';

/** what the Mattermost plugin forwards for one execution: the text after `/collegium`, and who ran it where */
export type $CommandRequestBody = z.infer<typeof $CommandRequestBody>;
export const $CommandRequestBody = z.object({
  channel_id: z.string().min(1),
  text: z.string().prefault(''),
  user_name: z.string().min(1)
});
