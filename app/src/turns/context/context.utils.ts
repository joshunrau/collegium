import { estimateTokens } from '@collegium/core/utils';
import { match } from 'ts-pattern';

import { renderDenialLine } from '@/approvals/approvals.renderer.ts';
import type { WindowEntry } from '@/conversations/conversations.types.ts';
import { renderPostWithAttachments, replayTextOf } from '@/conversations/conversations.utils.ts';
import type { CompletionMessage } from '@/inference/inference.types.ts';
import { reasoningOf } from '@/inference/inference.utils.ts';
import type { AuthorKind, ModelRow } from '@/prisma/prisma.types.ts';
import { renderRecordedToolName } from '@/utils/tool-name.utils.ts';

/** §5.2 — what closes a window that ends on the agent's own turn, so the model begins a message rather than continuing one */
const TURN_ENDED_LINE = '[your previous turn ended here; this turn is for what arrived while you were busy]';

/** §3.8 — what a post's author is, in the word the model reads beside the name */
const AUTHOR_KIND_WORDS: { readonly [K in AuthorKind]: string } = {
  agent: 'agent',
  human: 'person',
  system: 'system'
};

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
      results.set(payload.callId, replayTextOf(payload) ?? payload.output);
    } else if (payload.kind === 'approval_decided' && payload.callId !== undefined && payload.decision !== 'approved') {
      denials.set(
        payload.callId,
        renderDenialLine({ byUsername: payload.byUsername, reason: payload.reason, subject: 'the call' })
      );
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
  results: ReadonlyMap<string, string>,
  carriesReasoning: boolean
): CompletionMessage[] {
  const answered = payload.toolCalls.filter((call) => results.has(call.callId));
  if (payload.content === '' && answered.length === 0) {
    return [];
  }
  return [
    {
      content: payload.content,
      role: 'assistant',
      ...(carriesReasoning && reasoningOf(payload)),
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

/** §3.6 — a record replays as its description and whatever writing it removed, such as the memories a write evicted */
function renderRecordLine(payload: Extract<PrismaJson.TurnEventPayload, { kind: 'record_written' }>): string {
  const removed = payload.supersededDescriptions.map((description) => `"${description}"`).join(', ');
  return `[recorded: ${payload.description}${removed === '' ? '' : `; this removed ${removed}`}]`;
}

/**
 * The agent's own trace replays in the provider's native shape — assistant messages carrying their
 * tool calls, tool messages carrying the results — because that is the form the model produced it
 * in. Reasoning rides only on the rounds of the turn in progress (§3.12). A result is emitted beside
 * its call rather than where it fell in the trace, and an approval that names its call is folded
 * into that call's result; only a framework action with no call (the budget extension) still reads
 * as a line of transcript.
 */
function renderEvent(
  event: ModelRow<'TurnEvent'>,
  results: ReadonlyMap<string, string>,
  currentTurnId: string | undefined
): CompletionMessage[] {
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
      .with({ kind: 'assistant_message' }, (payload) => {
        return renderAssistantEvent(payload, results, event.turnId === currentTurnId);
      })
      // §8.3 — the model was told why and answered again; the trace alone keeps what was refused
      .with({ kind: 'output_rejected' }, (): CompletionMessage[] => [])
      .with({ kind: 'record_written' }, (payload): CompletionMessage[] => [
        { content: renderRecordLine(payload), role: 'user' }
      ])
      // §7.5 — a steer reads exactly as the post it resembles, so a later turn hears the human speaking
      .with({ kind: 'steering_received' }, (payload): CompletionMessage[] => [
        { content: renderAuthoredMessage(payload.byUsername, 'human', payload.text), role: 'user' }
      ])
      .with({ kind: 'tool_result' }, (): CompletionMessage[] => [])
      .exhaustive()
  );
}

/** §3.8 — an agent by its display name; a person keeps the username, so a reply that tags them copies it */
function renderAuthorName(post: ModelRow<'Post'>, reader: WindowReader): string {
  return post.authorKind === 'agent' ? reader.displayNameOf(post.authorUsername) : post.authorUsername;
}

function renderPost(post: ModelRow<'Post'>, reader: WindowReader): CompletionMessage {
  const content = renderPostWithAttachments(post);
  if (post.authorUsername === reader.username) {
    return { content, role: 'assistant' };
  }
  return { content: renderAuthoredMessage(renderAuthorName(post, reader), post.authorKind, content), role: 'user' };
}

function renderEntries(
  entries: readonly WindowEntry[],
  reader: WindowReader,
  currentTurnId: string | undefined
): CompletionMessage[] {
  const results = collectCallResults(entries);
  return entries.flatMap((entry) => {
    return entry.kind === 'post' ? [renderPost(entry.post, reader)] : renderEvent(entry.event, results, currentTurnId);
  });
}

/** §3.8 — what the window pays for a message: its text, and each call's name and arguments; never the wire envelope, and never reasoning (§3.12) */
function chargedTextOf(message: CompletionMessage): string {
  if (message.role !== 'assistant') {
    return message.content;
  }
  const calls = (message.toolCalls ?? []).flatMap((call) => [call.name, JSON.stringify(call.arguments)]);
  return [message.content, ...calls].join('\n');
}

/** §3.8 — the agent a window is rendered for, and how prose names the colleagues whose posts it holds */
export type WindowReader = {
  readonly displayNameOf: (agentUsername: string) => string;
  readonly username: string;
};

/**
 * §5.2 — a draining turn's window ends on the trace of the turn it drains behind, and a model
 * handed its own message as the last thing said continues it; the closing line makes the next
 * completion a new message.
 */
export function toCompletionMessages(
  entries: readonly WindowEntry[],
  reader: WindowReader,
  currentTurnId: string
): CompletionMessage[] {
  const messages = renderEntries(entries, reader, currentTurnId);
  const last = messages.at(-1);
  if (last === undefined || last.role === 'user') {
    return messages;
  }
  return [...messages, { content: TURN_ENDED_LINE, role: 'user' }];
}

/** §3.8 — what entries cost the window, measured on the messages they render to, so the budget and what the model reads cannot disagree */
export function estimateWindowTokens(entries: readonly WindowEntry[], reader: WindowReader): number {
  return renderEntries(entries, reader, undefined).reduce((sum, message) => {
    return sum + estimateTokens(chargedTextOf(message));
  }, 0);
}

/**
 * §3.8 — a post by someone else, as the model reads it: the author's name and what they are, so a
 * person is never mistaken for a colleague, and without the @ that read as a mention and was copied
 * back into replies.
 */
export function renderAuthoredMessage(authorName: string, kind: AuthorKind, content: string): string {
  return `${authorName} (${AUTHOR_KIND_WORDS[kind]}): ${content}`;
}
