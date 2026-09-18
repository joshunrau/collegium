/**
 * One segment of a tool identity (§1): lowercase snake_case with single underscores, never
 * doubled — which is what makes `__` an unambiguous join in the wire form.
 */
export const TOOL_SEGMENT_PATTERN = /^[a-z](?:_?[a-z0-9])*$/;

/** model providers reject tool names longer than 64 characters, and the wire `<namespace>__<tool>` form is what reaches them */
export const MAX_WIRE_NAME_LENGTH = 64;

export const DEFAULT_TOOL_TIMEOUT_MS = 5000;

/** a result longer than this replays as a line in later turns; a short one is cheaper to keep than to summarise */
export const REPLAY_VERBATIM_MAX_CHARS = 2000;

/**
 * A namespace, or one tool by its `ns::tool` ref: the grammar a config grant and a skill's declared
 * tools share (§3.5, §8). One separator, and each side a tool segment.
 */
export const TOOL_REF_PATTERN = /^[a-z](?:_?[a-z0-9])*(?:::[a-z](?:_?[a-z0-9])*)?$/;
