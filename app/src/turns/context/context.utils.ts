import { renderToolWireName } from '@collegium/core/tools';
import { format } from '@collegium/core/utils';
import { match } from 'ts-pattern';

import type { AgentProfile } from '@/agents/agents.types.ts';
import type { WindowEntry } from '@/conversations/conversations.types.ts';
import type { CompletionMessage } from '@/inference/inference.types.ts';
import type { ModelRow } from '@/prisma/prisma.types.ts';

import { CONJUNCTION, PREAMBLE } from './context.constants.ts';

/** replayed history is model-facing, so a structural name renders in wire form — never a second spelling (§1) */
function toWireName(name: PrismaJson.RecordedToolName): string {
  return typeof name === 'string' ? name : renderToolWireName(name);
}

const TOOL_CALL_TRANSCRIPT = /^\[called [^\s(]+\([\s\S]*\)\]$/mu;

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
      ...(payload.reasoningContent !== undefined && { reasoningContent: payload.reasoningContent }),
      ...(answered.length > 0 && {
        toolCalls: answered.map((call) => ({ arguments: call.args, id: call.callId, name: toWireName(call.toolName) }))
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
  return match(event.payload)
    .with({ kind: 'approval_decided' }, (payload): CompletionMessage[] => {
      if (payload.callId !== undefined) {
        return [];
      }
      const reason = payload.reason === undefined ? '' : `: ${payload.reason}`;
      return [{ content: `[approval ${payload.decision}${reason}]`, role: 'user' }];
    })
    .with({ kind: 'approval_requested' }, (payload): CompletionMessage[] => {
      return payload.callId === undefined
        ? [{ content: `[approval requested: ${toWireName(payload.toolName)}]`, role: 'user' }]
        : [];
    })
    .with({ kind: 'assistant_message' }, (payload) => renderAssistantEvent(payload, results))
    .with({ kind: 'record_written' }, (payload): CompletionMessage[] => [
      { content: `[recorded: ${payload.description}]`, role: 'user' }
    ])
    .with({ kind: 'tool_result' }, (): CompletionMessage[] => [])
    .exhaustive();
}

function renderPost(post: ModelRow<'Post'>, selfUsername: string): CompletionMessage {
  if (post.authorUsername === selfUsername) {
    return { content: post.message, role: 'assistant' };
  }
  return { content: `@${post.authorUsername}: ${post.message}`, role: 'user' };
}

export function toCompletionMessages(entries: readonly WindowEntry[], selfUsername: string): CompletionMessage[] {
  const results = collectCallResults(entries);
  return entries.flatMap((entry) => {
    return entry.kind === 'post' ? [renderPost(entry.post, selfUsername)] : renderEvent(entry.event, results);
  });
}

export type PreambleInput = {
  readonly actionBudget: number;
  readonly budgetExemptToolNames: readonly string[];
  readonly contextBudgetTokens: number;
};

export function renderPreamble(input: PreambleInput): string {
  return format(PREAMBLE, {
    actionBudget: input.actionBudget,
    budgetExemptCalls: CONJUNCTION.format(input.budgetExemptToolNames),
    contextBudgetTokens: input.contextBudgetTokens
  });
}

export function renderSystemPrompt(input: {
  memories: readonly { description: string; reference: string }[];
  peers: readonly AgentProfile[];
  preamble: PreambleInput;
  profile: AgentProfile;
  skillManifest: string;
}): string {
  const sections = [input.profile.systemPrompt, renderPreamble(input.preamble)];
  if (input.skillManifest !== '') {
    sections.push(
      `## Skills\n\nProcedures you can pull into context with skills__load when they apply:\n\n${input.skillManifest}`
    );
  }
  if (input.memories.length > 0) {
    const listing = input.memories.map((memory) => `- [${memory.reference}] ${memory.description}`).join('\n');
    sections.push(
      `## Memories\n\nYour saved memories; read a full body with memory__read when it matters:\n\n${listing}`
    );
  }
  if (input.peers.length > 0) {
    const listing = input.peers.map((peer) => `- @${peer.username} — ${peer.expertise}`).join('\n');
    sections.push(`## Peers\n\nColleagues in this channel:\n\n${listing}`);
  }
  return sections.join('\n\n');
}

/**
 * Whether output imitates the replayed transcript form instead of making a call. A model that has read
 * its own history in that form sometimes writes it back as an answer; posted, it runs nothing and
 * reads as a completed action.
 */
export function containsToolCallTranscript(text: string): boolean {
  return TOOL_CALL_TRANSCRIPT.test(text);
}
