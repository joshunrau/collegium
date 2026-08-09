import { match } from 'ts-pattern';

import type { AgentProfile } from '@/agents/agents.types.ts';
import type { WindowEntry } from '@/conversations/conversations.types.ts';
import type { CompletionMessage } from '@/inference/inference.types.ts';
import type { ModelRow } from '@/prisma/prisma.types.ts';

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
      content: `[approval requested: ${payload.toolName}]`,
      role: 'user'
    }))
    .with({ kind: 'assistant_message' }, (payload): CompletionMessage | undefined => {
      const calls = payload.toolCalls.map((call) => `[called ${call.toolName}(${JSON.stringify(call.args)})]`);
      const content = [payload.content, ...calls].filter((part) => part !== '').join('\n');
      return content === '' ? undefined : { content, role: 'assistant' };
    })
    .with({ kind: 'memory_written' }, (payload): CompletionMessage => ({
      content: `[memory saved: ${payload.description}]`,
      role: 'user'
    }))
    .with({ kind: 'tool_result' }, (payload): CompletionMessage => ({
      content: `[${payload.toolName} result] ${payload.output}`,
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

export function renderSystemPrompt(input: {
  memories: readonly { description: string; id: string }[];
  peers: readonly AgentProfile[];
  profile: AgentProfile;
  skillManifest: string;
}): string {
  const sections = [input.profile.systemPrompt];
  if (input.skillManifest !== '') {
    sections.push(
      `## Skills\n\nProcedures you can pull into context with load_skill when they apply:\n\n${input.skillManifest}`
    );
  }
  if (input.memories.length > 0) {
    const listing = input.memories.map((memory) => `- [${memory.id}] ${memory.description}`).join('\n');
    sections.push(
      `## Memories\n\nYour saved memories; read a full body with read_memory when it matters:\n\n${listing}`
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
