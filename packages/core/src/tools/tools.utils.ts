import { MAX_WIRE_NAME_LENGTH, REPLAY_VERBATIM_MAX_CHARS, TOOL_SEGMENT_PATTERN } from './tools.constants.ts';

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

/**
 * What a later turn reads in place of a result the model already acted on: what it was and how big,
 * never the text (§3.8). Worded as history, because a bare size reads to a model as a call that
 * returned nothing useful, and it reports the page unreadable instead of calling again.
 */
export function renderReplayLine(subject: string, text?: string): string {
  const size = text === undefined ? '' : `: ${text.length} characters`;
  return `[${subject}${size}, already read and no longer shown — call the tool again to reread it]`;
}

/** the replay line for a result worth replacing, or nothing for one short enough to keep verbatim */
export function replayWhenLong(subject: string, text: string): string | undefined {
  return text.length > REPLAY_VERBATIM_MAX_CHARS ? renderReplayLine(subject, text) : undefined;
}
