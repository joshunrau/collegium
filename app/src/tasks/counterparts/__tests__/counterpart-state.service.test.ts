import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { PendingDecisionsService } from '@/approvals/decisions/pending-decisions.service.ts';
import { ChannelLockService } from '@/channels/locks/channel-lock.service.ts';
import { getModelToken } from '@/prisma/prisma.utils.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';
import { createModelTable } from '@/testing/factories/model-table.factory.ts';

import { CounterpartStateService } from '../counterpart-state.service.ts';

type TurnRow = {
  agentUsername: string;
  channelId: string;
  endedAt: Date | null;
  startedAt: Date;
};

const ASSIGNED_AT = new Date('2026-09-22T18:40:00Z');

const ASSIGNED = {
  assigneeUsername: 'owen',
  channelId: 'channel-1',
  creatorUsername: 'mira',
  state: 'assigned',
  updatedAt: ASSIGNED_AT
} as const;

describe('CounterpartStateService', () => {
  let channelLockService: ChannelLockService;
  let counterpartStateService: CounterpartStateService;
  let pendingDecisionsService: MockedInstance<PendingDecisionsService>;
  let turns: ReturnType<typeof createModelTable<TurnRow>>;

  beforeEach(async () => {
    pendingDecisionsService = MockFactory.createMock(PendingDecisionsService);
    pendingDecisionsService.listPending.mockResolvedValue([]);
    turns = createModelTable<TurnRow>();
    const moduleRef = await Test.createTestingModule({
      providers: [
        ChannelLockService,
        CounterpartStateService,
        { provide: getModelToken('Turn'), useValue: turns },
        { provide: PendingDecisionsService, useValue: pendingDecisionsService }
      ]
    }).compile();
    channelLockService = moduleRef.get(ChannelLockService);
    counterpartStateService = moduleRef.get(CounterpartStateService);
  });

  const endedTurn = (agentUsername: string, startedAt: string, endedAt: string) => {
    return turns.create({
      data: { agentUsername, channelId: 'channel-1', endedAt: new Date(endedAt), startedAt: new Date(startedAt) }
    });
  };

  it('should say the move is the reader’s own, since the unit last changed', async () => {
    expect(await counterpartStateService.readFor(ASSIGNED, 'owen')).toStrictEqual({
      awaited: 'report',
      kind: 'awaiting-reader',
      since: ASSIGNED_AT
    });
    expect(await counterpartStateService.readFor({ ...ASSIGNED, state: 'review' }, 'mira')).toMatchObject({
      awaited: 'verdict',
      kind: 'awaiting-reader'
    });
  });

  it('should report the lane the counterpart holds here, and the earliest person its turn waits on', async () => {
    channelLockService.acquire('owen', 'channel-1');
    const heldSince = channelLockService.heldSince('owen', 'channel-1')!;
    const requestedAt = new Date(heldSince.getTime() + 60_000);
    pendingDecisionsService.listPending.mockResolvedValue([
      {
        actionName: 'ask::human',
        agentUsername: 'owen',
        channelId: 'channel-1',
        kind: 'ask',
        promptPostId: 'prompt-1',
        question: 'Which venue?',
        requestedAt,
        turnId: 'turn-1'
      }
    ]);
    expect(await counterpartStateService.readFor(ASSIGNED, 'mira')).toStrictEqual({
      awaited: 'report',
      beganBeforeChange: false,
      kind: 'in-turn',
      since: heldSince,
      waitingOn: { on: 'ask', since: requestedAt }
    });
    expect(pendingDecisionsService.listPending).toHaveBeenCalledWith({ agentUsername: 'owen', channelId: 'channel-1' });
    const reported = { ...ASSIGNED, state: 'review', updatedAt: new Date(heldSince.getTime() + 1) } as const;
    channelLockService.acquire('mira', 'channel-1');
    expect(await counterpartStateService.readFor(reported, 'owen')).toMatchObject({ beganBeforeChange: true });
  });

  it('should report how the counterpart’s latest turn here since the change ended, or that it had none', async () => {
    await endedTurn('owen', '2026-09-22T18:30:00Z', '2026-09-22T18:35:00Z');
    expect(await counterpartStateService.readFor(ASSIGNED, 'mira')).toStrictEqual({
      awaited: 'report',
      kind: 'no-turn'
    });
    await endedTurn('owen', '2026-09-22T18:45:00Z', '2026-09-22T18:50:00Z');
    await endedTurn('owen', '2026-09-22T18:55:00Z', '2026-09-22T19:02:00Z');
    expect(await counterpartStateService.readFor(ASSIGNED, 'mira')).toStrictEqual({
      awaited: 'report',
      endedAt: new Date('2026-09-22T19:02:00Z'),
      kind: 'turn-ended'
    });
  });
});
