import { z } from 'zod';

/**
 * The stored reference, in one place. `satisfies` is what keeps it there: `PrismaJson.TriggerReference`
 * is the column's type and is ambient, so the two agree at compile time without an import that would
 * point the wrong way. Extra keys still pass — a source may carry its own context — but every key the
 * renderer reads is declared here, `body` above all, since it is the one the renderer calls `.trim()`
 * on and an intake that let a non-string through stranded the row after its claim (§4.2).
 */
const $TriggerReference = z.looseObject({
  body: z.string().optional(),
  id: z.string().optional(),
  sender: z.string().optional(),
  subject: z.string().optional()
}) satisfies z.ZodType<PrismaJson.TriggerReference>;

/** what POST /triggers accepts — the one intake this roadmap ships (§4.2) */
export type $TriggerIntakeBody = z.infer<typeof $TriggerIntakeBody>;
export const $TriggerIntakeBody = z.object({
  reference: $TriggerReference.describe('A short pointer at the source event — never the work itself (A1)'),
  // deliberately narrower than the Prisma TriggerSource enum: intake accepts only webhooks today,
  // and each future source (cron, imap) widens this literal when its adapter actually lands
  source: z.literal('webhook').default('webhook'),
  targetAgentUsername: z.string().min(1),
  targetChannelId: z.string().min(1)
});
