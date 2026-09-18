import { z } from 'zod';

import { $ToolRef } from '../tools.ts';

export type $SkillFrontmatter = z.infer<typeof $SkillFrontmatter>;
export const $SkillFrontmatter = z.strictObject({
  description: z.string().min(1).max(200),
  title: z.string().min(1).max(80),
  /** §3.5 — what this procedure calls; boot refuses an agent granted the skill without them */
  tools: z.array($ToolRef).default([])
});
