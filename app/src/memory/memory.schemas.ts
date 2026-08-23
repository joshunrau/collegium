import { z } from 'zod';

/** the memory toolset's settings: the bounds on one agent's memory (§3.6) — every field defaulted, so a bare grant works */
export type $MemorySettings = z.infer<typeof $MemorySettings>;
export const $MemorySettings = z.strictObject({
  maxBodyChars: z
    .number()
    .int()
    .positive()
    .default(4000)
    .describe('Longest body one entry may hold. A longer write is refused rather than truncated.'),
  maxDescriptionChars: z
    .number()
    .int()
    .positive()
    .default(200)
    .describe(
      'Longest description one entry may hold. Descriptions enter the system prompt every turn, so this bounds that cost.'
    ),
  maxEntries: z
    .number()
    .int()
    .positive()
    .default(50)
    .describe('How many entries one agent may hold. Writing beyond it evicts the oldest entry.')
});
