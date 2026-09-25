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

/** §3.8 — the noun phrase a result replays as: what it was and how big, never what it said */
export function describeReplaySubject(name: string, text: string): string {
  return `${name}, ${text.length} characters`;
}

/** the replay subject for a result worth replacing, or nothing for one short enough to keep verbatim */
export function replaySubjectWhenLong(name: string, text: string): string | undefined {
  return text.length > REPLAY_VERBATIM_MAX_CHARS ? describeReplaySubject(name, text) : undefined;
}

/**
 * What a later turn reads in place of a result the model already acted on (§3.8). Worded as
 * history with the text's whereabouts, because a bare size reads to a model as a call that returned
 * nothing useful, and it reports the page unreadable instead of calling again.
 */
export function renderReplayLine(subject: string): string {
  return `[${subject} — from an earlier turn; its text is not shown. Make the call again if you need it.]`;
}
