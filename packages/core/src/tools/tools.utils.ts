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

/**
 * What the turn that made the call reads once the result is collapsed (§3.8). It states the cost
 * of a re-read rather than inviting one: told only that the text is gone, a model re-reads, which
 * evicts the next page, and the two chase each other until the budget runs out.
 */
export function renderSupersededLine(subject: string): string {
  return `[${subject} — read earlier this turn; its text is no longer shown. Reading it again may displace another result; copy what you need into your own text first.]`;
}

/** §3.8 — a repeat of a result still shown costs no context and says so, so a re-read is never mistaken for a changed page */
export function renderDuplicateLine(subject: string): string {
  return `[${subject} — identical to the result above; nothing changed.]`;
}

/**
 * §3.8 — the same content from another address, answered like a repeat. It says what was observed
 * and not why: a parameter the site ignores, a soft 404 and a login wall all look like this.
 */
export function renderSameContentLine(subject: string, earlierSubject: string): string {
  return `[${subject} — identical content to ${earlierSubject}, which is still shown above.]`;
}

/** §3.8 — what the same content read again opens with once the earlier copy is no longer shown */
export function renderSameContentNote(earlierSubject: string): string {
  return `[identical content to ${earlierSubject}, which you read earlier this turn]`;
}
