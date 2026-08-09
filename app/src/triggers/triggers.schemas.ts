import { z } from 'zod';

/** what POST /triggers accepts — the one intake this roadmap ships (§4.2) */
export type $TriggerIntakeBody = z.infer<typeof $TriggerIntakeBody>;
export const $TriggerIntakeBody = z.object({
  reference: z
    .looseObject({
      id: z.string().optional(),
      sender: z.string().optional(),
      subject: z.string().optional()
    })
    .describe('A short pointer at the source event — never the work itself (A1)'),
  // deliberately narrower than the Prisma TriggerSource enum: intake accepts only webhooks today,
  // and each future source (cron, imap) widens this literal when its adapter actually lands
  source: z.literal('webhook').default('webhook'),
  targetAgentUsername: z.string().min(1),
  targetChannelId: z.string().min(1)
});
