import { z } from 'zod';

export type $MattermostCommandBody = z.infer<typeof $MattermostCommandBody>;
export const $MattermostCommandBody = z.object({
  channel_id: z.string().min(1),
  command: z.string().min(1),
  text: z.string().prefault(''),
  user_name: z.string().min(1)
});
