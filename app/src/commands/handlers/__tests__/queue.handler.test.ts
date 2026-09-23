import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { AgentRegistry } from '@/agents/agents.registry.ts';
import { ChannelLockService } from '@/channels/locks/channel-lock.service.ts';
import { ConversationsService } from '@/conversations/conversations.service.ts';
import { DateFormatter } from '@/formatting/dates/date.formatter.ts';
import { QueueService } from '@/queue/queue.service.ts';
import { buildAgentProfile } from '@/testing/factories/agent-profile.factory.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';
import { TurnsService } from '@/turns/turns.service.ts';

import { LaneReportService } from '../../reports/lane-report.service.ts';
import { QueueHandler } from '../queue.handler.ts';

const MIRA = buildAgentProfile();

const ENTRY = {
  agentUsername: 'mira',
  channelId: 'channel-1',
  createdAt: new Date(0),
  earliestUnprocessedPostId: 'post-1',
  id: 'entry-1',
  lastEnqueuedAt: new Date(0)
};

describe('QueueHandler', () => {
  let channelLockService: MockedInstance<ChannelLockService>;
  let queueHandler: QueueHandler;
  let queueService: MockedInstance<QueueService>;
  let turnsService: MockedInstance<TurnsService>;

  const handle = (text: string) => {
    return queueHandler.handle({ channelId: 'channel-1', text, userId: 'casey-id', username: 'casey' });
  };

  beforeEach(async () => {
    const agentRegistry = MockFactory.createMock(AgentRegistry);
    agentRegistry.get.mockImplementation((username: string) => (username === 'mira' ? MIRA : undefined));
    agentRegistry.displayNameOf.mockReturnValue('Mira');
    channelLockService = MockFactory.createMock(ChannelLockService);
    channelLockService.heldSince.mockReturnValue(undefined);
    const conversationsService = MockFactory.createMock(ConversationsService);
    conversationsService.summarizeBacklog.mockResolvedValue({ message: 'scrape dal.ca', pendingCount: 2 });
    queueService = MockFactory.createMock(QueueService);
    queueService.peek.mockResolvedValue(ENTRY);
    queueService.discard.mockResolvedValue(ENTRY);
    turnsService = MockFactory.createMock(TurnsService);
    const dateFormatter = MockFactory.createMock(DateFormatter);
    dateFormatter.format.mockReturnValue('September 22, 2026 at 9:14:02 AM UTC');
    const moduleRef = await Test.createTestingModule({
      providers: [
        LaneReportService,
        QueueHandler,
        { provide: AgentRegistry, useValue: agentRegistry },
        { provide: ChannelLockService, useValue: channelLockService },
        { provide: ConversationsService, useValue: conversationsService },
        { provide: DateFormatter, useValue: dateFormatter },
        { provide: QueueService, useValue: queueService },
        { provide: TurnsService, useValue: turnsService }
      ]
    }).compile();
    queueHandler = moduleRef.get(QueueHandler);
  });

  it('should report pending depth to the caller alone', async () => {
    const response = await handle('mira');
    expect(response.audience).toBe('invoker');
    expect(response.text).toContain('2 post(s) pending');
  });

  it('should name the running turn, the post that started it, and that it has shown nothing yet (§8.4)', async () => {
    channelLockService.heldSince.mockReturnValue(new Date());
    turnsService.findRunningIn.mockResolvedValue({ statusPostId: null, triggeringPostId: 'post-0' });
    const [lane] = (await handle('mira')).text.split('\n');
    expect(lane).toBe(
      'mira in this channel: turn running for under a minute, since September 22, 2026 at 9:14:02 AM UTC, started by post `post-0`; no status post yet. A post addressing mira now queues behind it.'
    );
  });

  it('should report an idle lane and an empty queue', async () => {
    queueService.peek.mockResolvedValue(undefined);
    expect((await handle('mira')).text).toBe('mira in this channel: no turn running.\nQueue: empty.');
    expect(turnsService.findRunningIn).not.toHaveBeenCalled();
  });

  it('should discard the standing entry and say so in the channel', async () => {
    expect(await handle('mira clear')).toStrictEqual({
      audience: 'channel',
      text: '🗑️ Queued work discarded: Mira will not run what was waiting here.'
    });
    expect(queueService.discard).toHaveBeenCalledWith('mira', 'channel-1');
  });

  it('should tell the caller when a clear found nothing to discard', async () => {
    queueService.discard.mockResolvedValue(undefined);
    const response = await handle('mira clear');
    expect(response.audience).toBe('invoker');
    expect(response.text).toContain('Nothing discarded.');
  });

  it('should answer an unknown verb with the usage line', async () => {
    expect((await handle('mira drop')).text).toContain('Usage: /collegium queue');
    expect(queueService.discard).not.toHaveBeenCalled();
  });
});
