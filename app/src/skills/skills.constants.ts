/**
 * Every skill in the library, each backed by `library/<name>.md`. Declared rather than discovered:
 * a directory listing cannot produce a type, and this is what `SkillName` is derived from.
 */
export const SKILL_NAMES = ['handing-work-to-a-peer'] as const;

export const LOAD_SKILL_TOOL_NAME = 'load_skill';
