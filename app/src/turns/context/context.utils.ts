import { renderToolWireName } from '@collegium/core/tools';
import { format } from '@collegium/core/utils';
import { match } from 'ts-pattern';

import type { AgentProfile } from '@/agents/agents.types.ts';
import type { WindowEntry } from '@/conversations/conversations.types.ts';
import type { CompletionMessage } from '@/inference/inference.types.ts';
import type { ModelRow } from '@/prisma/prisma.types.ts';

/** §3.8 — every sentence states what the framework does, never what the model ought to do; an instruction does not belong here */
const PREAMBLE = `## How this works

You are one of a group of agents. You work with people in a shared Mattermost workspace. Each message you get is a post in this channel. The author name comes first, as \`@username:\`. There are no threads. Your context is the recent posts in this channel and your own recent actions here.

The framework posts your reply. Text with no tool call is your final message. It goes to the channel and the turn stops. Text with a tool call is shown while the tool runs. Then it is removed.

Some tools need approval from a person before they run. The approval prompt shows the full payload to all persons in the channel. There is no timeout. If a person denies with no reason, the turn stops. If a person denies with a reason, the reason comes back as the tool result. The turn then continues with the same budget.

Each turn has a budget of {actionBudget} tool calls. A denied call also uses the budget. Calls to {budgetExemptCalls} do not. When the budget is used, you report what you have. A person then decides if you get more.

Your memories are the only data that goes with you between channels. A memory write needs no approval. Each write is shown in the channel immediately.

When you mention a colleague, the colleague starts a turn in this channel. The colleague sees the channel posts only. The colleague does not see your tool results or your status text. If a post mentions two agents, the framework rejects it and tells you.

When the system bot posts an item for you, the item stays open until you mark it with triggers__resolve.

You cannot change your own instructions, tools, skills, model, or schedule. Memory is the only part of yourself you can write.`;

const CONJUNCTION = new Intl.ListFormat('en-US', { type: 'conjunction' });

/** replayed history is model-facing, so a structural name renders in wire form — never a second spelling (§1) */
function toWireName(name: PrismaJson.RecordedToolName): string {
  return typeof name === 'string' ? name : renderToolWireName(name);
}

/**
 * Replayed trace renders as plain text rather than native tool-call messages: history routinely
 * holds dangling calls — a denied approval or an abandoned turn records a call with no result —
 * and providers reject a tool message without its paired call. Text cannot be malformed.
 */
function renderEvent(event: ModelRow<'TurnEvent'>): CompletionMessage | undefined {
  return match(event.payload)
    .with({ kind: 'approval_decided' }, (payload): CompletionMessage => {
      const reason = payload.reason === undefined ? '' : `: ${payload.reason}`;
      return { content: `[approval ${payload.decision}${reason}]`, role: 'user' };
    })
    .with({ kind: 'approval_requested' }, (payload): CompletionMessage => ({
      content: `[approval requested: ${toWireName(payload.toolName)}]`,
      role: 'user'
    }))
    .with({ kind: 'assistant_message' }, (payload): CompletionMessage | undefined => {
      const calls = payload.toolCalls.map(
        (call) => `[called ${toWireName(call.toolName)}(${JSON.stringify(call.args)})]`
      );
      const content = [payload.content, ...calls].filter((part) => part !== '').join('\n');
      return content === '' ? undefined : { content, role: 'assistant' };
    })
    .with({ kind: 'record_written' }, (payload): CompletionMessage => ({
      content: `[recorded: ${payload.description}]`,
      role: 'user'
    }))
    .with({ kind: 'tool_result' }, (payload): CompletionMessage => ({
      content: `[${toWireName(payload.toolName)} result] ${payload.output}`,
      role: 'user'
    }))
    .exhaustive();
}

function renderPost(post: ModelRow<'Post'>, selfUsername: string): CompletionMessage {
  if (post.authorUsername === selfUsername) {
    return { content: post.message, role: 'assistant' };
  }
  return { content: `@${post.authorUsername}: ${post.message}`, role: 'user' };
}

export function toCompletionMessages(entries: readonly WindowEntry[], selfUsername: string): CompletionMessage[] {
  return entries.flatMap((entry) => {
    const message = entry.kind === 'post' ? renderPost(entry.post, selfUsername) : renderEvent(entry.event);
    return message === undefined ? [] : [message];
  });
}

export function renderPreamble(input: { actionBudget: number; budgetExemptToolNames: readonly string[] }): string {
  return format(PREAMBLE, {
    actionBudget: input.actionBudget,
    budgetExemptCalls: CONJUNCTION.format(input.budgetExemptToolNames)
  });
}

export function renderSystemPrompt(input: {
  memories: readonly { description: string; reference: string }[];
  peers: readonly AgentProfile[];
  preamble: { actionBudget: number; budgetExemptToolNames: readonly string[] };
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
    sections.push(
      `## Peers\n\nColleagues in this channel. Hand work to one by mentioning them, one per message:\n\n${listing}`
    );
  }
  return sections.join('\n\n');
}
