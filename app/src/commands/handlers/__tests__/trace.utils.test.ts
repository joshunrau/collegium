import { describe, expect, it } from 'vitest';

import type { ModelRow } from '@/prisma/prisma.types.ts';
import type { Turn } from '@/turns/turns.types.ts';

import { renderTrace } from '../trace.utils.ts';

const TURN = {
  agentUsername: 'mira',
  chainLength: 1,
  channelId: 'channel-1',
  depth: 0,
  id: 'turn-1',
  modelName: 'deepseek-v4-flash',
  status: 'completed'
} as Turn;

const NOW = new Date('2026-01-01T00:05:00.000Z');

const event = (payload: PrismaJson.TurnEventPayload): ModelRow<'TurnEvent'> => ({
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  id: 'event-1',
  kind: payload.kind,
  payload,
  sequence: 1,
  turnId: 'turn-1'
});

describe('renderTrace', () => {
  it('should report a turn that recorded nothing by its status, so a failed turn still reads', () => {
    expect(renderTrace({ ...TURN, status: 'provider_outage' }, [], [], NOW)).toBe(
      'Turn turn-1 (mira on deepseek-v4-flash, provider_outage, depth 0, chain 1) recorded no events: no tool call, approval, or record.'
    );
  });

  it('should number the approval lifecycle under a turn heading', () => {
    const text = renderTrace(TURN, [
      event({
        approvalId: 'a1',
        kind: 'approval_requested',
        payloadText: 'write a.md',
        toolName: ['workspace', 'write']
      }),
      event({ approvalId: 'a1', byUsername: 'casey', decision: 'approved', kind: 'approval_decided' })
    ], [], NOW);
    expect(text).toBe(
      [
        'Trace for turn turn-1 (mira on deepseek-v4-flash, completed, depth 0, chain 1):',
        '1. approval requested for `workspace::write`: write a.md',
        '2. approval a1 → approved by casey'
      ].join('\n')
    );
  });

  it('should say beneath the heading what a running turn waits on a person for (§8.1)', () => {
    const decision = {
      actionName: 'workspace::write',
      agentUsername: 'mira',
      channelId: 'channel-1',
      kind: 'approval',
      promptPostId: 'prompt-1',
      requestedAt: new Date('2026-01-01T00:00:00.000Z'),
      turnId: 'turn-1'
    } as const;
    const text = renderTrace(
      { ...TURN, status: 'running' },
      [event({ approvalId: 'a1', kind: 'approval_requested', payloadText: 'write a.md', toolName: ['workspace', 'write'] })],
      [{ decision, since: 'January 1, 2026 at 12:00:00 AM UTC' }],
      NOW
    );
    expect(text.split('\n')[1]).toBe(
      'Waiting on a person: 🔐 `workspace::write` · for 5m, since January 1, 2026 at 12:00:00 AM UTC · prompt `prompt-1`'
    );
  });

  it('should show the head of argument text that never parsed beside its result (§7.2)', () => {
    const text = renderTrace(TURN, [
      event({
        callId: 'c1',
        kind: 'tool_result',
        output: 'the arguments to this call were not valid JSON, so the call did not run',
        rawArgumentsPreview: '{"path": "a.txt", "content": "unterminated',
        toolName: ['workspace', 'write']
      })
    ], [], NOW);
    expect(text).toContain(
      '1. `workspace::write` → the arguments to this call were not valid JSON, so the call did not run (arguments as sent: {"path": "a.txt", "content": "unterminated)'
    );
  });

  it('should append the reason to a decision that carries one', () => {
    const text = renderTrace(TURN, [
      event({
        approvalId: 'a1',
        byUsername: 'casey',
        decision: 'denied_with_reason',
        kind: 'approval_decided',
        reason: 'wrong path'
      })
    ], [], NOW);
    expect(text).toContain('1. approval a1 → denied_with_reason by casey: wrong path');
  });

  it('should render a written record with its description and body', () => {
    const text = renderTrace(TURN, [
      event({
        body: 'ships on Fridays',
        description: 'release cadence',
        kind: 'record_written',
        reference: 'm1',
        supersededDescriptions: []
      })
    ], [], NOW);
    expect(text).toContain('1. record m1 written: release cadence — ships on Fridays');
  });

  it('should name the memories a write evicted (§3.6, §8.1)', () => {
    const text = renderTrace(TURN, [
      event({
        body: 'ships on Fridays',
        description: 'release cadence',
        kind: 'record_written',
        reference: 'm1',
        supersededDescriptions: ['an ancient note', 'a stale plan']
      })
    ], [], NOW);
    expect(text).toContain(
      '1. record m1 written, removing "an ancient note", "a stale plan": release cadence — ships on Fridays'
    );
  });

  it('should name a revision’s count, the passages it replaced and the description it replaced (§3.6)', () => {
    const text = renderTrace(TURN, [
      event({
        body: 'ships on Mondays',
        description: 'release cadence',
        kind: 'record_written',
        reference: 'm1',
        revision: { count: 3, replacedDescription: 'paused cadence', replacedPassages: ['Fridays'] },
        supersededDescriptions: []
      })
    ], [], NOW);
    expect(text).toContain(
      '1. record m1 revised (revision 3), replacing "Fridays", the description "paused cadence": release cadence — ships on Mondays'
    );
  });

  it('should leave the reasoning behind a completion out of the trace (§3.12)', () => {
    const text = renderTrace(TURN, [
      event({ content: 'done', kind: 'assistant_message', reasoningContent: 'private thoughts', toolCalls: [] })
    ], [], NOW);
    expect(text).toContain('1. assistant: done');
    expect(text).not.toContain('private thoughts');
  });

  it('should render a steer with its author (§7.5)', () => {
    expect(
      renderTrace(TURN, [event({ byUsername: 'casey', kind: 'steering_received', text: 'use staging' })], [], NOW)
    ).toContain('1. steered by casey: use staging');
  });

  it('should render a raw name for a call that resolved to no tool', () => {
    const text = renderTrace(TURN, [
      event({
        content: '',
        kind: 'assistant_message',
        toolCalls: [{ args: {}, callId: 'c1', toolName: 'does_not_exist' }]
      })
    ], [], NOW);
    expect(text).toContain('1. called `does_not_exist` with {}');
  });
});
