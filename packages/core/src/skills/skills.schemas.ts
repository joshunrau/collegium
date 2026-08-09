import { z } from 'zod';

export type $SkillFrontmatter = z.infer<typeof $SkillFrontmatter>;
export const $SkillFrontmatter = z.object({
  description: z.string().min(1).max(200),
  title: z.string().min(1).max(80)
});
