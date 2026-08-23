/**
 * Every skill in the framework library, each backed by `library/<name>.md`. Declared rather than
 * discovered: a directory listing cannot produce a type, and this is what `SkillName` derives from.
 */
export const SKILL_NAMES = ['handing-work-to-a-peer'] as const;

/** §9 — in every agent's manifest, never grantable; naming one in config is an error */
export const CORE_SKILL_NAMES = ['handing-work-to-a-peer'] as const satisfies readonly (typeof SKILL_NAMES)[number][];

/** the library skills an operator may assign — the bare-name half of the `agents[].skills` grammar */
export const GRANTABLE_SKILL_NAMES = SKILL_NAMES.filter(
  (name) => !(CORE_SKILL_NAMES as readonly string[]).includes(name)
);
