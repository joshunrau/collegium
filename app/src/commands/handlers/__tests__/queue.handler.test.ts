import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { AgentRegistry } from '@/agents/agents.registry.ts';
import { ConversationsService } from '@/conversations/conversations.service.ts';
import { QueueService } from '@/queue/queue.service.ts';
import { buildAgentProfile } from '@/testing/factories/agent-profile.factory.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';

import { QueueHandler } from '../queue.handler.ts';

const MIRA = buildAgentProfile();

const ENTRY = {
  agentUsername: 'mira',
  channelId: 'channel-1',
  createdAt: new Date(0),
  earliestUnprocessedPostId: 'post-1',
  id: 'entry-1'
};

describe('QueueHandler', () => {
  let queueHandler: QueueHandler;
  let queueService: MockedInstance<QueueService>;

  const handle = (text: string) =>
    queueHandler.handle({ channelId: 'channel-1', text, userId: 'casey-id', username: 'casey' });

  beforeEach(async () => {
    const agentRegistry = MockFactory.createMock(AgentRegistry);
    agentRegistry.get.mockImplementation((username: string) => (username === 'mira' ? MIRA : undefined));
    const conversationsService = MockFactory.createMock(ConversationsService);
    conversationsService.summarizeBacklog.mockResolvedValue({ message: 'scrape dal.ca', pendingCount: 2 });
    queueService = MockFactory.createMock(QueueService);
    queueService.peek.mockResolvedValue(ENTRY);
    queueService.discard.mockResolvedValue(ENTRY);
    const moduleRef = await Test.createTestingModule({
      providers: [
        QueueHandler,
        { provide: AgentRegistry, useValue: agentRegistry },
        { provide: ConversationsService, useValue: conversationsService },
        { provide: QueueService, useValue: queueService }
      ]
    }).compile();
    queueHandler = moduleRef.get(QueueHandler);
  });

  it('should report pending depth to the caller alone', async () => {
    const response = await handle('mira');
    expect(response.audience).toBe('invoker');
    expect(response.text).toContain('2 post(s) pending');
  });

  it('should discard the standing entry and say so in the channel', async () => {
    expect(await handle('mira clear')).toStrictEqual({
      audience: 'channel',
      text: '🗑️ Queued work discarded: mira will not run what was waiting here.'
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
