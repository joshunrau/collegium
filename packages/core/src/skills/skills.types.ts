import type { BUILTIN_SKILL_NAMES } from './skills.constants.ts';
import type { $SkillFrontmatter } from './skills.schemas.ts';

export type BuiltinSkillName = (typeof BUILTIN_SKILL_NAMES)[number];

/** A supporting document beside a skill's procedure, pulled on demand a layer beneath it (§3.5). */
export type SkillReference = $SkillFrontmatter & {
  readonly body: string;
};

/** A procedure document from a skill library (§3.5), keyed by its name, with its references beside it. */
export type Skill = $SkillFrontmatter & {
  readonly body: string;
  readonly references: ReadonlyMap<string, SkillReference>;
};
