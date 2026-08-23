/** skill names keep the dashed convention of skill files; a skill never reaches a provider as a tool name (§9) */
export const SKILL_NAME_PATTERN = /^[a-z](?:-?[a-z0-9])*$/;

/** `<namespace>::<skill>`: a toolset-shipped skill under the toolset's namespace — the one form the name has */
export const QUALIFIED_SKILL_NAME_PATTERN = /^[a-z](?:_?[a-z0-9])*::[a-z](?:-?[a-z0-9])*$/;
