import { describe, expect, it } from 'vitest';

import { createUnitCollector, replayLineOf } from '../window.utils.ts';

import type { WindowEntry } from '../../conversations.types.ts';

const event = (payload: PrismaJson.TurnEventPayload): WindowEntry => ({
  event: {
    createdAt: new Date(0),
    id: `event-${payload.kind}`,
    kind: payload.kind,
    payload,
    sequence: 0,
    turnId: 'turn-1'
  },
  kind: 'event'
});

describe('createUnitCollector', () => {
  it('should hold what answers a call until the call arrives, then return them as one unit (§3.8)', () => {
    const units = createUnitCollector();
    const result = event({ callId: 'c1', kind: 'tool_result', output: 'noon', toolName: ['builtins', 'now'] });
    const decision = event({
      approvalId: 'a1',
      byUsername: 'casey',
      callId: 'c1',
      decision: 'approved',
      kind: 'approval_decided'
    });
    const call = event({
      content: '',
      kind: 'assistant_message',
      toolCalls: [{ args: {}, callId: 'c1', toolName: ['builtins', 'now'] }]
    });
    expect(units.take(result)).toBeUndefined();
    expect(units.take(decision)).toBeUndefined();
    expect(units.take(call)).toStrictEqual([call, result, decision]);
  });

  it('should return an entry that answers no call alone', () => {
    const record = event({
      body: 'bullet points',
      description: 'casey on formatting',
      kind: 'record_written',
      reference: 'memory-1',
      supersededDescriptions: []
    });
    expect(createUnitCollector().take(record)).toStrictEqual([record]);
  });
});

describe('replayLineOf', () => {
  it('should read a result as the replay line the tool declared', () => {
    const payload = {
      callId: 'c1',
      kind: 'tool_result',
      output: 'x',
      replay: '[read notes.md (12 bytes)]',
      toolName: ['workspace', 'read']
    } as const;
    expect(replayLineOf(payload)).toBe('[read notes.md (12 bytes)]');
  });

  it('should render the line from the subject a tool named, in the later-turn words (§3.8)', () => {
    const payload = {
      callId: 'c1',
      kind: 'tool_result',
      output: 'x',
      replaySubject: 'read notes.md, 12 characters',
      toolName: ['workspace', 'read']
    } as const;
    expect(replayLineOf(payload)).toBe(
      '[read notes.md, 12 characters — from an earlier turn; its text is not shown. Make the call again if you need it.]'
    );
  });

  it('should read a result that declared none as its own name (§3.8)', () => {
    const payload = { callId: 'c1', kind: 'tool_result', output: 'sent', toolName: ['mail', 'send'] } as const;
    expect(replayLineOf(payload)).toBe('[mail__send]');
  });

  it('should read nothing from an event that is not a tool result', () => {
    expect(replayLineOf({ content: 'thinking', kind: 'assistant_message', toolCalls: [] })).toBeUndefined();
  });
});
