/** §3.5 — in every agent's manifest, never grantable; naming one in config is an error */
export const BUILTIN_CORE_SKILL_NAMES = ['handing-work-to-a-peer', 'understanding-collegium'] as const;

/** the library skills an operator may assign — the bare-name half of the `agents[].skills` grammar */
export const BUILTIN_GRANTABLE_SKILL_NAMES = [] as const;

/**
 * Every skill in the framework library, each backed by `library/<name>/SKILL.md`. Declared rather
 * than discovered: a directory listing cannot produce a type.
 */
export const BUILTIN_SKILL_NAMES = [...BUILTIN_CORE_SKILL_NAMES, ...BUILTIN_GRANTABLE_SKILL_NAMES] as const;

/** `<namespace>::<skill>`: a toolset-shipped skill under the toolset's namespace — the one form the name has */
export const QUALIFIED_SKILL_NAME_PATTERN = /^[a-z](?:_?[a-z0-9])*::[a-z](?:-?[a-z0-9])*$/;

/** the dashed convention of skill files, governing a skill name and a reference name alike (§3.5) */
export const SKILL_NAME_PATTERN = /^[a-z](?:-?[a-z0-9])*$/;

/** a skill is a directory; this is the procedure document at its root */
export const SKILL_DOCUMENT_FILENAME = 'SKILL.md';

export const SKILL_DOCUMENT_EXTENSION = '.md';

/** the one subdirectory of a skill the framework reads: its supporting documents (§3.5) */
export const SKILL_REFERENCES_DIRECTORY = 'references';
