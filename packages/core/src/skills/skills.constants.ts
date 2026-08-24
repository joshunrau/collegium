/** §9 — in every agent's manifest, never grantable; naming one in config is an error */
export const BUILTIN_CORE_SKILL_NAMES = ['handing-work-to-a-peer'] as const;

/** the library skills an operator may assign — the bare-name half of the `agents[].skills` grammar */
export const BUILTIN_GRANTABLE_SKILL_NAMES = [] as const;

/**
 * Every skill in the framework library, each backed by `library/<name>.md`. Declared rather than
 * discovered: a directory listing cannot produce a type.
 */
export const BUILTIN_SKILL_NAMES = [...BUILTIN_CORE_SKILL_NAMES, ...BUILTIN_GRANTABLE_SKILL_NAMES] as const;

/** `<namespace>::<skill>`: a toolset-shipped skill under the toolset's namespace — the one form the name has */
export const QUALIFIED_SKILL_NAME_PATTERN = /^[a-z](?:_?[a-z0-9])*::[a-z](?:-?[a-z0-9])*$/;

/** skill names keep the dashed convention of skill files; a skill never reaches a provider as a tool name (§9) */
export const SKILL_NAME_PATTERN = /^[a-z](?:-?[a-z0-9])*$/;
