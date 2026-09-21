import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { PendingDecisionsService } from '@/approvals/decisions/pending-decisions.service.ts';
import { ChannelLockService } from '@/channels/locks/channel-lock.service.ts';
import { ConfigService } from '@/config/config.service.ts';
import { HaltService } from '@/halt/halt.service.ts';
import { LoggingService } from '@/logging/logging.service.ts';
import { NotificationsService } from '@/notifications/notifications.service.ts';
import { QueueService } from '@/queue/queue.service.ts';
import type { QueueEntry } from '@/queue/queue.service.ts';
import { createConfigServiceMock } from '@/testing/factories/config-service.factory.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';
import { TurnControlRegistry } from '@/turns/control/turn-control.registry.ts';

import { StallsService } from '../stalls.service.ts';

const MINUTE_MS = 60_000;

const STARTED_AT = new Date('2026-09-18T12:00:00Z');

const at = (minutes: number): Date => new Date(STARTED_AT.getTime() + minutes * MINUTE_MS);

const entry = (id: string): QueueEntry => ({
  agentUsername: 'mira',
  channelId: 'channel-1',
  createdAt: STARTED_AT,
  earliestUnprocessedPostId: 'post-1',
  id,
  lastEnqueuedAt: STARTED_AT
});

const HELD = { acquiredAt: STARTED_AT, agentUsername: 'mira', channelId: 'channel-1' };

describe('StallsService', () => {
  let channelLockService: MockedInstance<ChannelLockService>;
  let haltService: MockedInstance<HaltService>;
  let notificationsService: MockedInstance<NotificationsService>;
  let pendingDecisionsService: MockedInstance<PendingDecisionsService>;
  let queueService: MockedInstance<QueueService>;
  let stallsService: StallsService;
  let turnControlRegistry: MockedInstance<TurnControlRegistry>;

  beforeEach(async () => {
    channelLockService = MockFactory.createMock(ChannelLockService);
    channelLockService.isBusy.mockReturnValue(false);
    channelLockService.listHeld.mockReturnValue([]);
    haltService = MockFactory.createMock(HaltService);
    haltService.isHalted.mockReturnValue(false);
    notificationsService = MockFactory.createMock(NotificationsService);
    notificationsService.notify.mockResolvedValue(undefined);
    pendingDecisionsService = MockFactory.createMock(PendingDecisionsService);
    pendingDecisionsService.isWaitingOnPerson.mockResolvedValue(false);
    queueService = MockFactory.createMock(QueueService);
    queueService.listAll.mockResolvedValue([]);
    turnControlRegistry = MockFactory.createMock(TurnControlRegistry);
    turnControlRegistry.surfaceStatusPosts.mockResolvedValue(false);
    const moduleRef = await Test.createTestingModule({
      providers: [
        StallsService,
        { provide: ChannelLockService, useValue: channelLockService },
        { provide: ConfigService, useValue: createConfigServiceMock() },
        { provide: HaltService, useValue: haltService },
        MockFactory.createForService(LoggingService),
        { provide: NotificationsService, useValue: notificationsService },
        { provide: PendingDecisionsService, useValue: pendingDecisionsService },
        { provide: QueueService, useValue: queueService },
        { provide: TurnControlRegistry, useValue: turnControlRegistry }
      ]
    }).compile();
    stallsService = moduleRef.get(StallsService);
  });

  it('should announce a standing queue once, after it has stood for the threshold (§7.6)', async () => {
    queueService.listAll.mockResolvedValue([entry('entry-1')]);
    for (const minutes of [0, 9, 10, 20]) {
      await stallsService.sweep(at(minutes));
    }
    expect(notificationsService.notify.mock.calls).toStrictEqual([
      [{ agentUsername: 'mira', channelId: 'channel-1', kind: 'standing-queue' }]
    ]);
  });

  it('should re-arm the standing-queue notice once the entry drains (§7.6)', async () => {
    queueService.listAll.mockResolvedValue([entry('entry-1')]);
    await stallsService.sweep(at(0));
    await stallsService.sweep(at(10));
    queueService.listAll.mockResolvedValue([]);
    await stallsService.sweep(at(11));
    queueService.listAll.mockResolvedValue([entry('entry-2')]);
    await stallsService.sweep(at(12));
    await stallsService.sweep(at(22));
    expect(notificationsService.notify).toHaveBeenCalledTimes(2);
  });

  it('should announce a long turn with how long it has held the channel, once its status post is surfaced (§7.6)', async () => {
    channelLockService.listHeld.mockReturnValue([HELD]);
    turnControlRegistry.surfaceStatusPosts.mockResolvedValue(true);
    await stallsService.sweep(at(29));
    await stallsService.sweep(at(31));
    expect(turnControlRegistry.surfaceStatusPosts).toHaveBeenCalledExactlyOnceWith('mira', 'channel-1');
    expect(notificationsService.notify.mock.calls).toStrictEqual([
      [
        {
          agentUsername: 'mira',
          channelId: 'channel-1',
          heldMs: 31 * MINUTE_MS,
          kind: 'long-turn',
          postsWaiting: false,
          tracedNothing: true
        }
      ]
    ]);
  });

  it('should announce a long turn again when a post queues behind it, and not for the same entry twice (§7.6)', async () => {
    channelLockService.listHeld.mockReturnValue([HELD]);
    channelLockService.isBusy.mockReturnValue(true);
    await stallsService.sweep(at(31));
    queueService.listAll.mockResolvedValue([entry('entry-1')]);
    await stallsService.sweep(at(40));
    await stallsService.sweep(at(41));
    expect(notificationsService.notify.mock.calls).toStrictEqual([
      [expect.objectContaining({ heldMs: 31 * MINUTE_MS, kind: 'long-turn', postsWaiting: false })],
      [expect.objectContaining({ heldMs: 40 * MINUTE_MS, kind: 'long-turn', postsWaiting: true })]
    ]);
  });

  it('should restart the long-turn clock while a decision is pending (§7.6)', async () => {
    channelLockService.listHeld.mockReturnValue([HELD]);
    pendingDecisionsService.isWaitingOnPerson.mockResolvedValue(true);
    await stallsService.sweep(at(25));
    pendingDecisionsService.isWaitingOnPerson.mockResolvedValue(false);
    await stallsService.sweep(at(40));
    expect(notificationsService.notify).not.toHaveBeenCalled();
    await stallsService.sweep(at(55));
    expect(notificationsService.notify).toHaveBeenCalledWith(expect.objectContaining({ heldMs: 30 * MINUTE_MS }));
  });

  it('should announce nothing while a global halt stands (§7.6)', async () => {
    haltService.isHalted.mockReturnValue(true);
    channelLockService.listHeld.mockReturnValue([HELD]);
    queueService.listAll.mockResolvedValue([entry('entry-1')]);
    await stallsService.sweep(at(0));
    await stallsService.sweep(at(60));
    expect(notificationsService.notify).not.toHaveBeenCalled();
  });
});
