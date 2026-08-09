import { describe, expect, it } from 'vitest';

import type { ModelRow } from '@/prisma/prisma.types.ts';

import { renderTrace } from '../trace.utils.ts';

const event = (payload: PrismaJson.TurnEventPayload): ModelRow<'TurnEvent'> => ({
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  id: 'event-1',
  kind: payload.kind,
  payload,
  sequence: 1,
  turnId: 'turn-1'
});

describe('renderTrace', () => {
  it('should report a turn that recorded nothing', () => {
    expect(renderTrace('turn-1', [])).toBe('Turn turn-1 recorded no events.');
  });

  it('should number the approval lifecycle under a turn heading', () => {
    const text = renderTrace('turn-1', [
      event({ approvalId: 'a1', kind: 'approval_requested', payloadText: 'write a.md', toolName: 'write_file' }),
      event({ approvalId: 'a1', byUsername: 'casey', decision: 'approved', kind: 'approval_decided' })
    ]);
    expect(text).toBe(
      [
        'Trace for turn turn-1:',
        '1. approval requested for `write_file`: write a.md',
        '2. approval a1 → approved by casey'
      ].join('\n')
    );
  });

  it('should append the reason to a decision that carries one', () => {
    const text = renderTrace('turn-1', [
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

  it('should render a written memory with its description and body', () => {
    const text = renderTrace('turn-1', [
      event({ body: 'ships on Fridays', description: 'release cadence', kind: 'memory_written', memoryId: 'm1' })
    ]);
    expect(text).toContain('1. memory m1 written: release cadence — ships on Fridays');
  });
});
