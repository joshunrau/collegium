import { describe, expect, it } from 'vitest';

import type { ModelRow } from '@/prisma/prisma.types.ts';
import type { Turn } from '@/turns/turns.types.ts';

import { renderTrace } from '../trace.utils.ts';

const TURN = {
  agentUsername: 'mira',
  channelId: 'channel-1',
  id: 'turn-1',
  modelName: 'deepseek-v4-flash',
  status: 'completed'
} as Turn;

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
    expect(renderTrace({ ...TURN, status: 'provider_outage' }, [])).toBe(
      'Turn turn-1 (mira on deepseek-v4-flash, provider_outage) recorded no events: no tool call, approval, or record.'
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
    ]);
    expect(text).toBe(
      [
        'Trace for turn turn-1 (mira on deepseek-v4-flash, completed):',
        '1. approval requested for `workspace::write`: write a.md',
        '2. approval a1 → approved by casey'
      ].join('\n')
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
    ]);
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
    ]);
    expect(text).toContain('1. record m1 written: release cadence — ships on Fridays');
  });

  it('should render a raw name for a call that resolved to no tool', () => {
    const text = renderTrace(TURN, [
      event({
        content: '',
        kind: 'assistant_message',
        toolCalls: [{ args: {}, callId: 'c1', toolName: 'does_not_exist' }]
      })
    ]);
    expect(text).toContain('1. called `does_not_exist` with {}');
  });
});
