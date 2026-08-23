/**
 * One segment of a tool identity (§1): lowercase snake_case with single underscores, never
 * doubled — which is what makes `__` an unambiguous join in the wire form.
 */
export const TOOL_SEGMENT_PATTERN = /^[a-z](?:_?[a-z0-9])*$/;

/** model providers reject tool names longer than 64 characters, and the wire `<namespace>__<tool>` form is what reaches them */
export const MAX_WIRE_NAME_LENGTH = 64;

/**
 * A tool's identity: two segments, held structurally everywhere and rendered per audience (§1).
 * Segments are never parsed back out of a rendered form except at the config perimeter — a name
 * arriving from the model is resolved by lookup against rendered wire names, not by splitting.
 */
export type ToolId = readonly [namespace: string, name: string];

/** the human-facing form: operators, approvers, config, trace, status post, logs, errors */
export function renderToolDisplayName([namespace, name]: ToolId): string {
  return `${namespace}::${name}`;
}

/**
 * The model-facing form, produced at request assembly and applied to the tool schemas and the
 * replayed call history together; nothing downstream of the provider response retains it.
 */
export function renderToolWireName([namespace, name]: ToolId): string {
  return `${namespace}__${name}`;
}
