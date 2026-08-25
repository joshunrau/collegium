import { MAX_WIRE_NAME_LENGTH, TOOL_SEGMENT_PATTERN } from './tools.constants.ts';

import type { ToolId } from './tools.types.ts';

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

export function assertToolSegment(value: string, subject: string): void {
  if (!TOOL_SEGMENT_PATTERN.test(value)) {
    throw new Error(`${subject} "${value}" is not lowercase snake_case with single underscores`);
  }
}

export function assertWireNameWithinLimit(id: ToolId): void {
  const wireName = renderToolWireName(id);
  if (wireName.length > MAX_WIRE_NAME_LENGTH) {
    throw new Error(`tool name "${wireName}" exceeds the ${MAX_WIRE_NAME_LENGTH}-character provider limit`);
  }
}
