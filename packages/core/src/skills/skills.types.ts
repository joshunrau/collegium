import type { BUILTIN_SKILL_NAMES } from './skills.constants.ts';
import type { $SkillFrontmatter } from './skills.schemas.ts';

export type BuiltinSkillName = (typeof BUILTIN_SKILL_NAMES)[number];

/** A procedure document from a skill library (§3.5), keyed by its name. */
export type Skill = $SkillFrontmatter & {
  readonly body: string;
};
