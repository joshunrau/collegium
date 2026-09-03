import { Result } from '@collegium/core/utils';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { AgentRegistry } from '@/agents/agents.registry.ts';
import type { AgentProfile } from '@/agents/agents.types.ts';
import type { ChatTransport } from '@/chat/chat.transport.ts';
import type { ChatFailure } from '@/chat/chat.types.ts';
import { TransportRegistry } from '@/chat/transports/transport.registry.ts';
import type { ObservedPost } from '@/conversations/conversations.types.ts';
import { LoggingService } from '@/logging/logging.service.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';
import { createObservedPost } from '@/testing/factories/observed-post.factory.ts';

import { ConversationsService } from '../../conversations.service.ts';
import { BackfillService } from '../backfill.service.ts';

const post = (id: string): ObservedPost => createObservedPost({ id });

describe('BackfillService', () => {
  let backfillService: BackfillService;
  let conversationsService: MockedInstance<ConversationsService>;
  let loggingService: MockedInstance<LoggingService>;
  let memberships: { [username: string]: Result<string[], ChatFailure> };
  let postsSince: (channelId: string) => Result<ObservedPost[], ChatFailure>;
  let reads: { channelId: string; since: string | undefined; username: string }[];

  beforeEach(async () => {
    conversationsService = MockFactory.createMock(ConversationsService);
    conversationsService.latestPostIdIn.mockImplementation((channelId) => {
      return Promise.resolve(channelId === 'channel-1' ? 'post-5' : undefined);
    });
    conversationsService.record.mockResolvedValue(true);
    loggingService = MockFactory.createMock(LoggingService);
    memberships = { mira: Result.ok(['channel-1']), owen: Result.ok(['channel-2']) };
    postsSince = (channelId) => Result.ok([post(`${channelId}-new`)]);
    reads = [];
    const agentRegistry = MockFactory.createMock(AgentRegistry);
    agentRegistry.list.mockReturnValue([{ username: 'mira' } as AgentProfile, { username: 'owen' } as AgentProfile]);
    const transportRegistry = {
      get: (username: string): ChatTransport => {
        return {
          getChannelMemberships: () => Promise.resolve(memberships[username]!),
          postsSince: (channelId: string, since: string | undefined) => {
            reads.push({ channelId, since, username });
            return Promise.resolve(postsSince(channelId));
          }
        } as ChatTransport;
      }
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        BackfillService,
        { provide: AgentRegistry, useValue: agentRegistry },
        { provide: ConversationsService, useValue: conversationsService },
        { provide: LoggingService, useValue: loggingService },
        { provide: TransportRegistry, useValue: transportRegistry }
      ]
    }).compile();
    backfillService = moduleRef.get(BackfillService);
  });

  it('should read each channel through its own agent from the last recorded post forward', async () => {
    await backfillService.run();
    expect(reads).toStrictEqual([
      { channelId: 'channel-1', since: 'post-5', username: 'mira' },
      { channelId: 'channel-2', since: undefined, username: 'owen' }
    ]);
    expect(conversationsService.record).toHaveBeenCalledTimes(2);
  });

  it('should skip an agent whose memberships cannot be read and carry on with the next', async () => {
    memberships.mira = Result.err<ChatFailure>({ kind: 'api', message: 'forbidden' });
    await backfillService.run();
    expect(reads).toStrictEqual([{ channelId: 'channel-2', since: undefined, username: 'owen' }]);
    expect(loggingService.error).toHaveBeenCalledOnce();
  });

  it('should skip a channel whose history cannot be read and carry on with the next', async () => {
    postsSince = (channelId) => {
      return channelId === 'channel-1'
        ? Result.err<ChatFailure>({ kind: 'api', message: 'gone' })
        : Result.ok([post('kept')]);
    };
    await backfillService.run();
    expect(conversationsService.record).toHaveBeenCalledOnce();
    expect(loggingService.error).toHaveBeenCalledOnce();
  });
});
