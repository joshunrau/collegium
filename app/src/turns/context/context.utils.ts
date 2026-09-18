import { match } from 'ts-pattern';

import type { WindowEntry } from '@/conversations/conversations.types.ts';
import { renderPostWithAttachments } from '@/conversations/conversations.utils.ts';
import type { CompletionMessage } from '@/inference/inference.types.ts';
import { reasoningOf } from '@/inference/inference.utils.ts';
import type { ModelRow } from '@/prisma/prisma.types.ts';
import { renderRecordedToolName } from '@/utils/tool-name.utils.ts';

const FENCED_CODE_BLOCK = /```[\s\S]*?```/gu;
const TOOL_CALL_TRANSCRIPT = /^\[called [^\s(]+\([\s\S]*\)\]$/mu;

/** a provider that dropped its structured `tool_calls` field leaves the call as a bare object in the text */
function isBareCallObject(text: string): boolean {
  try {
    const parsed: unknown = JSON.parse(text);
    return (
      typeof parsed === 'object' &&
      parsed !== null &&
      'arguments' in parsed &&
      'name' in parsed &&
      typeof parsed.name === 'string'
    );
  } catch {
    return false;
  }
}

function renderDenial(decision: { byUsername: string; reason?: string }): string {
  return decision.reason === undefined
    ? `denied by @${decision.byUsername}`
    : `denied by @${decision.byUsername}: ${decision.reason}`;
}

/**
 * What history can answer for each call: the tool's own result, or the human decision that refused
 * it — a bare denial ends the turn before any result exists, so the decision is the result. A call
 * with neither (an abandoned turn, a window cut mid-batch) is dropped from its assistant message
 * rather than sent unanswered, which providers reject.
 */
function collectCallResults(entries: readonly WindowEntry[]): ReadonlyMap<string, string> {
  const results = new Map<string, string>();
  const denials = new Map<string, string>();
  for (const entry of entries) {
    if (entry.kind !== 'event') {
      continue;
    }
    const { payload } = entry.event;
    if (payload.kind === 'tool_result') {
      results.set(payload.callId, payload.replay ?? payload.output);
    } else if (payload.kind === 'approval_decided' && payload.callId !== undefined && payload.decision !== 'approved') {
      denials.set(payload.callId, renderDenial(payload));
    }
  }
  for (const [callId, denial] of denials) {
    if (!results.has(callId)) {
      results.set(callId, denial);
    }
  }
  return results;
}

function renderAssistantEvent(
  payload: Extract<PrismaJson.TurnEventPayload, { kind: 'assistant_message' }>,
  results: ReadonlyMap<string, string>
): CompletionMessage[] {
  const answered = payload.toolCalls.filter((call) => results.has(call.callId));
  if (payload.content === '' && answered.length === 0) {
    return [];
  }
  return [
    {
      content: payload.content,
      role: 'assistant',
      ...reasoningOf(payload),
      ...(answered.length > 0 && {
        toolCalls: answered.map((call) => ({
          arguments: call.args,
          id: call.callId,
          name: renderRecordedToolName(call.toolName)
        }))
      })
    },
    ...answered.map((call): CompletionMessage => ({
      content: results.get(call.callId)!,
      role: 'tool',
      toolCallId: call.callId
    }))
  ];
}

/**
 * The agent's own trace replays in the provider's native shape — assistant messages carrying their
 * tool calls and reasoning, tool messages carrying the results — because that is the form the model
 * produced it in. A result is emitted beside its call rather than where it fell in the trace, and
 * an approval that names its call is folded into that call's result; only a framework action with
 * no call (the budget extension) still reads as a line of transcript.
 */
function renderEvent(event: ModelRow<'TurnEvent'>, results: ReadonlyMap<string, string>): CompletionMessage[] {
  return (
    match(event.payload)
      .with({ kind: 'approval_decided' }, (payload): CompletionMessage[] => {
        if (payload.callId !== undefined) {
          return [];
        }
        const reason = payload.reason === undefined ? '' : `: ${payload.reason}`;
        return [{ content: `[approval ${payload.decision}${reason}]`, role: 'user' }];
      })
      .with({ kind: 'approval_requested' }, (payload): CompletionMessage[] => {
        return payload.callId === undefined
          ? [{ content: `[approval requested: ${renderRecordedToolName(payload.toolName)}]`, role: 'user' }]
          : [];
      })
      // §3.7a — an answered ask is recorded as that call's ordinary `tool_result`, so the window
      // replays it through the call itself and neither ask event folds into anything here
      .with({ kind: 'ask_answered' }, (): CompletionMessage[] => [])
      .with({ kind: 'ask_requested' }, (): CompletionMessage[] => [])
      .with({ kind: 'assistant_message' }, (payload) => renderAssistantEvent(payload, results))
      .with({ kind: 'record_written' }, (payload): CompletionMessage[] => [
        { content: `[recorded: ${payload.description}]`, role: 'user' }
      ])
      // §7.5 — a steer reads exactly as the post it resembles, so a later turn hears the human speaking
      .with({ kind: 'steering_received' }, (payload): CompletionMessage[] => [
        { content: `@${payload.byUsername}: ${payload.text}`, role: 'user' }
      ])
      .with({ kind: 'tool_result' }, (): CompletionMessage[] => [])
      .exhaustive()
  );
}

function renderPost(post: ModelRow<'Post'>, selfUsername: string): CompletionMessage {
  const content = renderPostWithAttachments(post);
  if (post.authorUsername === selfUsername) {
    return { content, role: 'assistant' };
  }
  return { content: `@${post.authorUsername}: ${content}`, role: 'user' };
}

export function toCompletionMessages(entries: readonly WindowEntry[], selfUsername: string): CompletionMessage[] {
  const results = collectCallResults(entries);
  return entries.flatMap((entry) => {
    return entry.kind === 'post' ? [renderPost(entry.post, selfUsername)] : renderEvent(entry.event, results);
  });
}

/**
 * Whether output is a tool call written as text instead of made: the replayed transcript form a
 * model writes back after reading its own history, or the two shapes a provider leaves behind when
 * it fails to structure a call — a leaked `<tool_call>` marker, or the bare call object. Fenced code
 * is stripped before the last two are tested, so prose that quotes the syntax is not mistaken for
 * using it. Posted, any of the three runs nothing and reads as a completed action.
 */
export function containsToolCallTranscript(text: string): boolean {
  if (TOOL_CALL_TRANSCRIPT.test(text)) {
    return true;
  }
  const stripped = text.replace(FENCED_CODE_BLOCK, '').trim();
  return stripped !== '' && (stripped.startsWith('<tool_call>') || isBareCallObject(stripped));
}
