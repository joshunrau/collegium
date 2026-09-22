import { describe, expect, it } from 'vitest';

import type { WindowEntry } from '@/conversations/conversations.types.ts';
import type { AuthorKind } from '@/prisma/prisma.types.ts';

import { containsToolCallTranscript, estimateWindowTokens, toCompletionMessages } from '../context.utils.ts';

const event = (payload: PrismaJson.TurnEventPayload, turnId = 'turn-1'): WindowEntry => ({
  event: { createdAt: new Date(0), id: 'event-1', kind: payload.kind, payload, sequence: 0, turnId },
  kind: 'event'
});

/** the turn being assembled for; the fixture events belong to an earlier one unless a test says otherwise */
const CURRENT_TURN_ID = 'turn-2';

const render = (entries: WindowEntry[]) => toCompletionMessages(entries, 'mira', CURRENT_TURN_ID);

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
const replayOf = (entries: WindowEntry[]) => {
  return render([...entries, post('casey', 'next')]).slice(0, -1);
};

describe('toCompletionMessages', () => {
  it('should name a post’s author as a person, an agent or the system, and speak the agent’s own posts as the assistant (§3.8)', () => {
    const agentPost = post('tess', 'I can take it', null, 'agent');
    const systemPost = post('collegium', '[trigger] mail', null, 'system');
    expect(render([agentPost, systemPost])).toStrictEqual([
      { content: 'tess (agent): I can take it', role: 'user' },
      { content: 'collegium (system): [trigger] mail', role: 'user' }
    ]);
    expect(render([post('casey', 'hello @mira'), post('mira', 'on it'), post('casey', 'thanks')])).toStrictEqual([
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
    expect(render([post('casey', 'hello @mira'), reply]).at(-1)).toStrictEqual(turnEnded);

    const call = event({
      content: '',
      kind: 'assistant_message',
      toolCalls: [{ args: {}, callId: 'c1', toolName: ['builtins', 'now'] }]
    });
    const result = event({ callId: 'c1', kind: 'tool_result', output: 'noon', toolName: ['builtins', 'now'] });
    expect(render([call, result]).at(-1)).toStrictEqual(turnEnded);
    expect(render([reply, post('casey', 'thanks')]).at(-1)).toStrictEqual({
      content: 'casey (person): thanks',
      role: 'user'
    });
  });

  it("should append a post's attachment lines after its text", () => {
    const files = [{ id: 'file-1', mimeType: 'application/pdf', name: 'q3-report.pdf', size: 421888 }];
    expect(render([post('casey', 'what do you think?', { files })])).toStrictEqual([
      {
        content: 'casey (person): what do you think?\n[attached: q3-report.pdf (application/pdf, 421888 bytes)]',
        role: 'user'
      }
    ]);
  });

  it('should replay a call beside its result in native form, with its reasoning only in the turn in progress (§3.12)', () => {
    const entries = (turnId: string) => [
      event(
        {
          content: 'checking',
          kind: 'assistant_message',
          reasoningContent: 'the skill says how',
          toolCalls: [{ args: { name: 'handing-work-to-a-peer' }, callId: 'c1', toolName: ['skills', 'load'] }]
        },
        turnId
      ),
      event(
        { callId: 'c1', kind: 'tool_result', output: '# Handing work to a peer', toolName: ['skills', 'load'] },
        turnId
      )
    ];

    expect(replayOf(entries('turn-1'))).toStrictEqual([
      {
        content: 'checking',
        role: 'assistant',
        toolCalls: [{ arguments: { name: 'handing-work-to-a-peer' }, id: 'c1', name: 'skills__load' }]
      },
      { content: '# Handing work to a peer', role: 'tool', toolCallId: 'c1' }
    ]);
    expect(replayOf(entries(CURRENT_TURN_ID))[0]).toMatchObject({ reasoningContent: 'the skill says how' });
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

  it("should replay a long result whose tool gave no line as the tool's name and size (§3.8)", () => {
    const entries = [
      event({
        content: '',
        kind: 'assistant_message',
        toolCalls: [{ args: { reference: 'memory-1' }, callId: 'c1', toolName: ['memory', 'read'] }]
      }),
      event({ callId: 'c1', kind: 'tool_result', output: 'x'.repeat(40_000), toolName: ['memory', 'read'] })
    ];

    expect(replayOf(entries).at(-1)).toStrictEqual({
      content:
        '[memory__read result, 40000 characters — from an earlier turn; its text is not shown. Make the call again if you need it.]',
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
    expect(render([event({ byUsername: 'casey', kind: 'steering_received', text: 'use staging' })])).toStrictEqual([
      { content: 'casey (person): use staging', role: 'user' }
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

    expect(render(entries)).toStrictEqual([
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

    expect(render(entries)).toStrictEqual([{ content: '[recorded: casey on formatting]', role: 'user' }]);
  });
});

describe('estimateWindowTokens', () => {
  const call = (reasoningContent?: string) => {
    return event({
      content: 'checking',
      kind: 'assistant_message',
      ...(reasoningContent !== undefined && { reasoningContent }),
      toolCalls: [{ args: { reference: 'memory-1' }, callId: 'c1', toolName: ['memory', 'read'] }]
    });
  };
  const result = event({ callId: 'c1', kind: 'tool_result', output: 'x'.repeat(40_000), toolName: ['memory', 'read'] });

  it("should charge a call its text, name and arguments beside its result's replay line, never its reasoning (§3.8, §3.12)", () => {
    const cost = estimateWindowTokens([call(), result], 'mira');
    expect(cost).toBeLessThan(60);
    expect(estimateWindowTokens([call('y'.repeat(40_000)), result], 'mira')).toBe(cost);
  });

  it('should charge a written memory its one line, not its body', () => {
    const record = event({
      body: 'x'.repeat(16_000),
      description: 'casey on formatting',
      kind: 'record_written',
      reference: 'memory-1',
      supersededDescriptions: []
    });
    expect(estimateWindowTokens([record], 'mira')).toBe(Math.ceil('[recorded: casey on formatting]'.length / 4));
  });

  it("should charge a post's attachment lines as well as its text", () => {
    const files = [{ id: 'file-1', mimeType: 'application/pdf', name: 'q3-report.pdf', size: 421888 }];
    expect(estimateWindowTokens([post('casey', 'hi', { files })], 'mira')).toBeGreaterThan(
      estimateWindowTokens([post('casey', 'hi')], 'mira')
    );
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
