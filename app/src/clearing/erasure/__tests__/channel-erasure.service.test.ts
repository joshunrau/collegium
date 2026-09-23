import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { ApprovalsService } from '@/approvals/approvals.service.ts';
import { AsksService } from '@/approvals/asks.service.ts';
import { ConversationsService } from '@/conversations/conversations.service.ts';
import type { RecordablePost } from '@/conversations/conversations.types.ts';
import { EpisodesService } from '@/conversations/episodes/episodes.service.ts';
import { MemoryService } from '@/memory/memory.service.ts';
import { PrismaService } from '@/prisma/prisma.service.ts';
import { QueueService } from '@/queue/queue.service.ts';
import { TasksService } from '@/tasks/tasks.service.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';
import { TriggersService } from '@/triggers/triggers.service.ts';
import { TurnsService } from '@/turns/turns.service.ts';

import { ChannelErasure } from '../channel-erasure.service.ts';

const BOUNDARY = { eventsAfter: new Date(6000), postsAfter: new Date(5000) };

const NOTICE: RecordablePost = {
  attachments: [],
  authorKind: 'system',
  authorUsername: 'collegium',
  channelId: 'channel-1',
  createdAt: new Date(5000),
  id: 'notice-1',
  message: '🧹 casey is clearing this channel.'
};

/** the transaction client every participant must be handed, distinguishable from the injected models */
const TRANSACTION = { kind: 'transaction' } as unknown as Parameters<TurnsService['eraseContentBefore']>[2];

describe('ChannelErasure', () => {
  let approvalsService: MockedInstance<ApprovalsService>;
  let asksService: MockedInstance<AsksService>;
  let channelErasure: ChannelErasure;
  let conversationsService: MockedInstance<ConversationsService>;
  let episodesService: MockedInstance<EpisodesService>;
  let memoryService: MockedInstance<MemoryService>;
  let queueService: MockedInstance<QueueService>;
  let tasksService: MockedInstance<TasksService>;
  let triggersService: MockedInstance<TriggersService>;
  let turnsService: MockedInstance<TurnsService>;

  beforeEach(async () => {
    approvalsService = MockFactory.createMock(ApprovalsService);
    asksService = MockFactory.createMock(AsksService);
    conversationsService = MockFactory.createMock(ConversationsService);
    episodesService = MockFactory.createMock(EpisodesService);
    memoryService = MockFactory.createMock(MemoryService);
    queueService = MockFactory.createMock(QueueService);
    tasksService = MockFactory.createMock(TasksService);
    triggersService = MockFactory.createMock(TriggersService);
    turnsService = MockFactory.createMock(TurnsService);
    const moduleRef = await Test.createTestingModule({
      providers: [
        ChannelErasure,
        { provide: ApprovalsService, useValue: approvalsService },
        { provide: AsksService, useValue: asksService },
        { provide: ConversationsService, useValue: conversationsService },
        { provide: EpisodesService, useValue: episodesService },
        { provide: MemoryService, useValue: memoryService },
        { provide: PrismaService, useValue: { $transaction: (run: (client: unknown) => unknown) => run(TRANSACTION) } },
        { provide: QueueService, useValue: queueService },
        { provide: TasksService, useValue: tasksService },
        { provide: TriggersService, useValue: triggersService },
        { provide: TurnsService, useValue: turnsService }
      ]
    }).compile();
    channelErasure = moduleRef.get(ChannelErasure);
  });

  it('should record the notice first, then hand every module the boundary and the one transaction (§8.5)', async () => {
    const tally = await channelErasure.erase({
      boundary: BOUNDARY,
      channelId: 'channel-1',
      notice: NOTICE,
      selectMemories: false
    });
    expect(tally).toStrictEqual([]);
    expect(conversationsService.record).toHaveBeenCalledWith(NOTICE, undefined, TRANSACTION);
    expect(conversationsService.eraseBefore).toHaveBeenCalledAfter(conversationsService.record);
    for (const participant of [
      conversationsService.eraseBefore,
      episodesService.eraseBefore,
      episodesService.recordClear,
      turnsService.eraseContentBefore,
      approvalsService.eraseBefore,
      asksService.eraseBefore,
      tasksService.eraseBefore,
      triggersService.eraseDeliveredBefore
    ]) {
      expect(participant).toHaveBeenCalledExactlyOnceWith('channel-1', BOUNDARY, TRANSACTION);
    }
    expect(queueService.eraseBefore).toHaveBeenCalledExactlyOnceWith('channel-1', BOUNDARY, 'notice-1', TRANSACTION);
    expect(turnsService.listTriggeringPostIdsIn).not.toHaveBeenCalled();
  });

  it('should name the memories written from turns here, per agent, before the pointers go', async () => {
    turnsService.listTriggeringPostIdsIn.mockResolvedValue(['post-1', 'post-2']);
    memoryService.listOriginatingFrom.mockResolvedValue([
      { agentUsername: 'mira', id: 'm1' },
      { agentUsername: 'jo', id: 'm3' },
      { agentUsername: 'mira', id: 'm2' }
    ]);
    const tally = await channelErasure.erase({
      boundary: BOUNDARY,
      channelId: 'channel-1',
      notice: NOTICE,
      selectMemories: true
    });
    expect(tally).toStrictEqual([
      { agentUsername: 'mira', memoryIds: ['m1', 'm2'] },
      { agentUsername: 'jo', memoryIds: ['m3'] }
    ]);
    expect(memoryService.listOriginatingFrom).toHaveBeenCalledWith(['post-1', 'post-2'], TRANSACTION);
    expect(turnsService.eraseContentBefore).toHaveBeenCalledAfter(turnsService.listTriggeringPostIdsIn);
  });
});
