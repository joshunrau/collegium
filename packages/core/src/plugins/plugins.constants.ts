/** `<plugin>__<capability>`: the join is unambiguous because neither half may contain a double underscore */
export const PLUGIN_NAME_SEPARATOR = '__';

/** lowercase slug, single underscores only — the separator stays unambiguous */
export const PLUGIN_NAME_PATTERN = /^[a-z](?:_?[a-z0-9])*$/;

/** bare tool and collection names follow the plugin-name charset; skills use the framework's dashed convention */
export const PLUGIN_TOOL_NAME_PATTERN = /^[a-z](?:_?[a-z0-9])*$/;
export const PLUGIN_SKILL_NAME_PATTERN = /^[a-z](?:-?[a-z0-9])*$/;

/** `<plugin>__<tool>`: both halves in the bare grammar, whose single-underscore rule keeps the join unambiguous */
export const QUALIFIED_TOOL_NAME_PATTERN = /^[a-z](?:_?[a-z0-9])*__[a-z](?:_?[a-z0-9])*$/;

/** `<plugin>__<skill>`: an underscore-slug plugin qualifying a dashed skill name */
export const QUALIFIED_SKILL_NAME_PATTERN = /^[a-z](?:_?[a-z0-9])*__[a-z](?:-?[a-z0-9])*$/;

/** model providers (Anthropic and OpenAI-compatible alike) reject tool names longer than 64 characters, and the qualified `<plugin>__<tool>` form is what reaches them */
export const MAX_TOOL_NAME_LENGTH = 64;
