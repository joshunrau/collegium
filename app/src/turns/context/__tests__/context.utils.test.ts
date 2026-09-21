import { describe, expect, it } from 'vitest';

import type { WindowEntry } from '@/conversations/conversations.types.ts';
import type { AuthorKind } from '@/prisma/prisma.types.ts';

import { containsToolCallTranscript, toCompletionMessages } from '../context.utils.ts';

const event = (payload: PrismaJson.TurnEventPayload): WindowEntry => ({
  event: { createdAt: new Date(0), id: 'event-1', kind: payload.kind, payload, sequence: 0, turnId: 'turn-1' },
  kind: 'event'
});

const post = (
  authorUsername: string,
  message: string,
  attachments: null | PrismaJson.PostAttachments = null,
  authorKind: AuthorKind = 'human'
): WindowEntry => ({
  kind: 'post',
  post: {
    attachments,
    authoringTurnId: null,
    authorKind,
    authorUsername,
    channelId: 'channel-1',
    createdAt: new Date(0),
    id: 'post-1',
    isForgotten: false,
    kind: 'message',
    message,
    observedAt: new Date(0)
  }
});

/** the replay of the agent's own trace alone: a peer's post closes the window so the §5.2 line never appears, then is dropped */
const replayOf = (entries: WindowEntry[]) =>
  toCompletionMessages([...entries, post('casey', 'next')], 'mira').slice(0, -1);

describe('toCompletionMessages', () => {
  it('should name a post’s author as a person, an agent or the system, and speak the agent’s own posts as the assistant (§3.8)', () => {
    const agentPost = post('tess', 'I can take it', null, 'agent');
    const systemPost = post('collegium', '[trigger] mail', null, 'system');
    expect(toCompletionMessages([agentPost, systemPost], 'mira')).toStrictEqual([
      { content: 'tess (agent): I can take it', role: 'user' },
      { content: 'collegium (system): [trigger] mail', role: 'user' }
    ]);
    expect(
      toCompletionMessages([post('casey', 'hello @mira'), post('mira', 'on it'), post('casey', 'thanks')], 'mira')
    ).toStrictEqual([
      { content: 'casey (person): hello @mira', role: 'user' },
      { content: 'on it', role: 'assistant' },
      { content: 'casey (person): thanks', role: 'user' }
    ]);
  });

  it('should close a window that ends on the agent’s own turn with the line marking where it ended (§5.2)', () => {
    const turnEnded = {
      content: '[your previous turn ended here; this turn is for what arrived while you were busy]',
      role: 'user'
    };
    const reply = event({ content: 'done, see above', kind: 'assistant_message', toolCalls: [] });
    expect(toCompletionMessages([post('casey', 'hello @mira'), reply], 'mira').at(-1)).toStrictEqual(turnEnded);

    const call = event({
      content: '',
      kind: 'assistant_message',
      toolCalls: [{ args: {}, callId: 'c1', toolName: ['builtins', 'now'] }]
    });
    const result = event({ callId: 'c1', kind: 'tool_result', output: 'noon', toolName: ['builtins', 'now'] });
    expect(toCompletionMessages([call, result], 'mira').at(-1)).toStrictEqual(turnEnded);
    expect(toCompletionMessages([reply, post('casey', 'thanks')], 'mira').at(-1)).toStrictEqual({
      content: 'casey (person): thanks',
      role: 'user'
    });
  });

  it("should append a post's attachment lines after its text", () => {
    const files = [{ id: 'file-1', mimeType: 'application/pdf', name: 'q3-report.pdf', size: 421888 }];
    expect(toCompletionMessages([post('casey', 'what do you think?', { files })], 'mira')).toStrictEqual([
      {
        content: 'casey (person): what do you think?\n[attached: q3-report.pdf (application/pdf, 421888 bytes)]',
        role: 'user'
      }
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

    expect(replayOf(entries)).toStrictEqual([
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

    expect(replayOf(entries).at(-1)).toStrictEqual({
      content: '[loaded skill managing-prospects]',
      role: 'tool',
      toolCallId: 'c1'
    });
  });

  it('should replay a result by the subject the tool named, rendered as the later-turn line (§3.8)', () => {
    const entries = [
      event({
        content: '',
        kind: 'assistant_message',
        toolCalls: [{ args: { url: 'https://x.example/' }, callId: 'c1', toolName: ['web', 'fetch'] }]
      }),
      event({
        callId: 'c1',
        kind: 'tool_result',
        output: '# A page',
        replaySubject: 'page https://x.example/, 8 characters',
        toolName: ['web', 'fetch']
      })
    ];

    expect(replayOf(entries).at(-1)).toStrictEqual({
      content:
        '[page https://x.example/, 8 characters — from an earlier turn; its text is not shown. Make the call again if you need it.]',
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

    expect(replayOf(entries)).toStrictEqual([
      {
        content: 'two things',
        role: 'assistant',
        toolCalls: [{ arguments: {}, id: 'c2', name: 'builtins__now' }]
      },
      { content: 'noon', role: 'tool', toolCallId: 'c2' }
    ]);
  });

  it('should replay a forgiven call beside its unparseable-arguments result, never the raw text (§7.2)', () => {
    const entries = [
      event({
        content: '',
        kind: 'assistant_message',
        toolCalls: [{ args: {}, callId: 'c1', toolName: ['workspace', 'write'] }]
      }),
      event({
        callId: 'c1',
        kind: 'tool_result',
        output: 'the arguments to this call were not valid JSON, so the call did not run',
        rawArgumentsPreview: '{"content": "unterminated',
        toolName: ['workspace', 'write']
      })
    ];

    expect(replayOf(entries)).toStrictEqual([
      { content: '', role: 'assistant', toolCalls: [{ arguments: {}, id: 'c1', name: 'workspace__write' }] },
      {
        content: 'the arguments to this call were not valid JSON, so the call did not run',
        role: 'tool',
        toolCallId: 'c1'
      }
    ]);
  });

  it('should replay a steering event as the human speaking (§7.5)', () => {
    expect(
      toCompletionMessages([event({ byUsername: 'casey', kind: 'steering_received', text: 'use staging' })], 'mira')
    ).toStrictEqual([{ content: 'casey (person): use staging', role: 'user' }]);
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

    expect(replayOf(entries)).toStrictEqual([
      {
        content: '',
        role: 'assistant',
        toolCalls: [{ arguments: { path: 'notes.md' }, id: 'c1', name: 'workspace__write' }]
      },
      { content: 'casey denied the call', role: 'tool', toolCallId: 'c1' }
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
    expect(containsToolCallTranscript('')).toBe(false);
  });

  it('should recognise a leaked tool-call marker and a bare call object a provider failed to structure', () => {
    expect(containsToolCallTranscript('<tool_call>{"name":"shell__run","arguments":{}}</tool_call>')).toBe(true);
    expect(containsToolCallTranscript('\n{"name":"shell__run","arguments":{"command":"ls"}}')).toBe(true);
  });

  it('should leave a JSON answer without arguments, and syntax quoted in a code fence, alone', () => {
    expect(containsToolCallTranscript('{"name":"report","rows":3}')).toBe(false);
    expect(containsToolCallTranscript('A call looks like this:\n```\n<tool_call>{"name":"x"}</tool_call>\n```')).toBe(
      false
    );
  });
});
