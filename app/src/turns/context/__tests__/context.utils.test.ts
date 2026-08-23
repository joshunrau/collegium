import { describe, expect, it } from 'vitest';

import type { AgentProfile } from '@/agents/agents.types.ts';
import type { WindowEntry } from '@/conversations/conversations.types.ts';

import { renderSystemPrompt, toCompletionMessages } from '../context.utils.ts';

const event = (payload: PrismaJson.TurnEventPayload): WindowEntry => ({
  event: { createdAt: new Date(0), id: 'event-1', kind: payload.kind, payload, sequence: 0, turnId: 'turn-1' },
  kind: 'event'
});

const post = (authorUsername: string, message: string): WindowEntry => ({
  kind: 'post',
  post: {
    authoringTurnId: null,
    authorKind: 'human',
    authorUsername,
    channelId: 'channel-1',
    createdAt: new Date(0),
    id: 'post-1',
    isForgotten: false,
    message,
    observedAt: new Date(0)
  }
});

const PEER = { expertise: 'scheduling', username: 'tess' } as AgentProfile;

const PROFILE = { expertise: 'testing', systemPrompt: 'You are Mira.', username: 'mira' } as AgentProfile;

describe('toCompletionMessages', () => {
  it('should attribute a peer post and speak the agent own posts as the assistant', () => {
    expect(toCompletionMessages([post('casey', 'hello @mira'), post('mira', 'on it')], 'mira')).toStrictEqual([
      { content: '@casey: hello @mira', role: 'user' },
      { content: 'on it', role: 'assistant' }
    ]);
  });

  it('should replay approval events, carrying a denial reason when there is one', () => {
    const entries = [
      event({
        approvalId: 'a1',
        kind: 'approval_requested',
        payloadText: 'write notes.md',
        toolName: ['workspace', 'write']
      }),
      event({ approvalId: 'a1', byUsername: 'casey', decision: 'denied', kind: 'approval_decided' }),
      event({
        approvalId: 'a2',
        byUsername: 'casey',
        decision: 'denied_with_reason',
        kind: 'approval_decided',
        reason: 'not that file'
      })
    ];

    expect(toCompletionMessages(entries, 'mira')).toStrictEqual([
      { content: '[approval requested: workspace__write]', role: 'user' },
      { content: '[approval denied]', role: 'user' },
      { content: '[approval denied_with_reason: not that file]', role: 'user' }
    ]);
  });

  it('should replay a written record as a user message', () => {
    const entries = [
      event({
        body: 'bullet points, never prose',
        description: 'casey on formatting',
        kind: 'record_written',
        reference: 'memory-1',
        supersededDescriptions: []
      })
    ];

    expect(toCompletionMessages(entries, 'mira')).toStrictEqual([
      { content: '[recorded: casey on formatting]', role: 'user' }
    ]);
  });

  it('should replay tool calls as text and drop an assistant message with nothing in it', () => {
    const entries = [
      event({
        content: 'checking',
        kind: 'assistant_message',
        toolCalls: [{ args: { name: 'handing-work-to-a-peer' }, callId: 'c1', toolName: ['skills', 'load'] }]
      }),
      event({ content: '', kind: 'assistant_message', toolCalls: [] })
    ];

    expect(toCompletionMessages(entries, 'mira')).toStrictEqual([
      { content: 'checking\n[called skills__load({"name":"handing-work-to-a-peer"})]', role: 'assistant' }
    ]);
  });
});

describe('renderSystemPrompt', () => {
  it('should carry the agent prompt alone when it has no skills, memories, or peers', () => {
    expect(renderSystemPrompt({ memories: [], peers: [], profile: PROFILE, skillManifest: '' })).toBe('You are Mira.');
  });

  it('should append the skills, memories, and peers sections in §3.8 order', () => {
    expect(
      renderSystemPrompt({
        memories: [{ description: 'casey prefers bullet points', id: 'memory-1' }],
        peers: [PEER],
        profile: PROFILE,
        skillManifest: '- handing-work-to-a-peer: How to hand work over.'
      })
    ).toBe(
      `You are Mira.

## Skills

Procedures you can pull into context with skills__load when they apply:

- handing-work-to-a-peer: How to hand work over.

## Memories

Your saved memories; read a full body with memory__read when it matters:

- [memory-1] casey prefers bullet points

## Peers

Colleagues in this channel. Hand work to one by mentioning them, one per message:

- @tess — scheduling`
    );
  });
});
