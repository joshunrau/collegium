import { describe, expect, it } from 'vitest';

import type { WindowEntry } from '@/conversations/conversations.types.ts';

import { containsToolCallTranscript, toCompletionMessages } from '../context.utils.ts';

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

describe('toCompletionMessages', () => {
  it('should attribute a peer post and speak the agent own observed posts as the assistant', () => {
    expect(toCompletionMessages([post('casey', 'hello @mira'), post('mira', 'on it')], 'mira')).toStrictEqual([
      { content: '@casey: hello @mira', role: 'user' },
      { content: 'on it', role: 'assistant' }
    ]);
  });

  it('should replay a call beside its result in native form, carrying the reasoning that produced it', () => {
    const entries = [
      event({
        content: 'checking',
        kind: 'assistant_message',
        reasoningContent: 'the skill says how',
        toolCalls: [{ args: { name: 'handing-work-to-a-peer' }, callId: 'c1', toolName: ['skills', 'load'] }]
      }),
      event({ callId: 'c1', kind: 'tool_result', output: '# Handing work to a peer', toolName: ['skills', 'load'] })
    ];

    expect(toCompletionMessages(entries, 'mira')).toStrictEqual([
      {
        content: 'checking',
        reasoningContent: 'the skill says how',
        role: 'assistant',
        toolCalls: [{ arguments: { name: 'handing-work-to-a-peer' }, id: 'c1', name: 'skills__load' }]
      },
      { content: '# Handing work to a peer', role: 'tool', toolCallId: 'c1' }
    ]);
  });

  it('should replay a result by its replay text when the tool gave one', () => {
    const entries = [
      event({
        content: '',
        kind: 'assistant_message',
        toolCalls: [{ args: { name: 'managing-prospects' }, callId: 'c1', toolName: ['skills', 'load'] }]
      }),
      event({
        callId: 'c1',
        kind: 'tool_result',
        output: '# Managing prospects\n\nA long document…',
        replay: '[loaded skill managing-prospects]',
        toolName: ['skills', 'load']
      })
    ];

    expect(toCompletionMessages(entries, 'mira').at(-1)).toStrictEqual({
      content: '[loaded skill managing-prospects]',
      role: 'tool',
      toolCallId: 'c1'
    });
  });

  it('should drop a call history cannot answer, and the message when nothing of it remains', () => {
    const entries = [
      event({
        content: 'two things',
        kind: 'assistant_message',
        toolCalls: [
          { args: {}, callId: 'c1', toolName: ['builtins', 'now'] },
          { args: {}, callId: 'c2', toolName: ['builtins', 'now'] }
        ]
      }),
      event({ callId: 'c2', kind: 'tool_result', output: 'noon', toolName: ['builtins', 'now'] }),
      event({ content: '', kind: 'assistant_message', toolCalls: [{ args: {}, callId: 'c3', toolName: 'ghost' }] })
    ];

    expect(toCompletionMessages(entries, 'mira')).toStrictEqual([
      {
        content: 'two things',
        role: 'assistant',
        toolCalls: [{ arguments: {}, id: 'c2', name: 'builtins__now' }]
      },
      { content: 'noon', role: 'tool', toolCallId: 'c2' }
    ]);
  });

  it('should fold a denial into the result of the call it refused, naming the human', () => {
    const entries = [
      event({
        content: '',
        kind: 'assistant_message',
        toolCalls: [{ args: { path: 'notes.md' }, callId: 'c1', toolName: ['workspace', 'write'] }]
      }),
      event({
        approvalId: 'a1',
        callId: 'c1',
        kind: 'approval_requested',
        payloadText: 'write notes.md',
        toolName: ['workspace', 'write']
      }),
      event({ approvalId: 'a1', byUsername: 'casey', callId: 'c1', decision: 'denied', kind: 'approval_decided' })
    ];

    expect(toCompletionMessages(entries, 'mira')).toStrictEqual([
      {
        content: '',
        role: 'assistant',
        toolCalls: [{ arguments: { path: 'notes.md' }, id: 'c1', name: 'workspace__write' }]
      },
      { content: 'denied by @casey', role: 'tool', toolCallId: 'c1' }
    ]);
  });

  it('should keep the transcript lines for an approval that gates no call', () => {
    const entries = [
      event({ approvalId: 'a2', kind: 'approval_requested', payloadText: 'extend?', toolName: 'extend_budget' }),
      event({
        approvalId: 'a2',
        byUsername: 'casey',
        decision: 'denied_with_reason',
        kind: 'approval_decided',
        reason: 'wrap up'
      })
    ];

    expect(toCompletionMessages(entries, 'mira')).toStrictEqual([
      { content: '[approval requested: extend_budget]', role: 'user' },
      { content: '[approval denied_with_reason: wrap up]', role: 'user' }
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
});

describe('containsToolCallTranscript', () => {
  it('should recognise the replayed call form, including a fabricated tool name', () => {
    expect(containsToolCallTranscript('[called web__navigate({"url":"http://x"})]')).toBe(true);
    expect(containsToolCallTranscript('Sure.\n[called read_memory({"id":"m1"})]')).toBe(true);
  });

  it('should leave prose that merely mentions a tool alone', () => {
    expect(containsToolCallTranscript('I called web__navigate and it worked')).toBe(false);
  });
});
