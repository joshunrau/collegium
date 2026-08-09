import type { $SkillFrontmatter } from './skills.schemas.ts';

/** A procedure document from a skill library (§3.5), keyed by its name. */
export type Skill = $SkillFrontmatter & {
  readonly body: string;
};
