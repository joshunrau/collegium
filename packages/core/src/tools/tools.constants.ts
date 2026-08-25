/**
 * One segment of a tool identity (§1): lowercase snake_case with single underscores, never
 * doubled — which is what makes `__` an unambiguous join in the wire form.
 */
export const TOOL_SEGMENT_PATTERN = /^[a-z](?:_?[a-z0-9])*$/;

/** model providers reject tool names longer than 64 characters, and the wire `<namespace>__<tool>` form is what reaches them */
export const MAX_WIRE_NAME_LENGTH = 64;

export const DEFAULT_TOOL_TIMEOUT_MS = 5000;
