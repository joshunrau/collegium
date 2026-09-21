import { Result } from '@collegium/core/utils';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import type { AgentProfile } from '@/agents/agents.types.ts';
import { RosterService } from '@/channels/roster/roster.service.ts';
import { ChatGateway } from '@/chat/chat.gateway.ts';
import { ChatTransport } from '@/chat/chat.transport.ts';
import { TransportRegistry } from '@/chat/transports/transport.registry.ts';
import { LoggingService } from '@/logging/logging.service.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';

import { ChannelAnnouncer } from '../channel-announcer.service.ts';

describe('ChannelAnnouncer', () => {
  let channelAnnouncer: ChannelAnnouncer;
  let chatGateway: MockedInstance<ChatGateway>;
  let loggingService: MockedInstance<LoggingService>;
  let rosterService: MockedInstance<RosterService>;
  let transport: MockedInstance<ChatTransport>;

  beforeEach(async () => {
    chatGateway = MockFactory.createMock(ChatGateway);
    chatGateway.postAsSystemIn.mockResolvedValue(
      Result.ok({ authorUsername: 'collegium', createdAt: new Date(1000), postId: 'post-1' })
    );
    chatGateway.updateSystemPost.mockResolvedValue(Result.ok());
    loggingService = MockFactory.createMock(LoggingService);
    rosterService = MockFactory.createMock(RosterService);
    rosterService.isDirectMessage.mockReturnValue(false);
    rosterService.listAgentsIn.mockReturnValue([]);
    transport = MockFactory.createMock(ChatTransport);
    transport.send.mockResolvedValue(Result.ok({ createdAt: new Date(2000), postId: 'post-2' }));
    transport.updatePost.mockResolvedValue(Result.ok());
    const transportRegistry = MockFactory.createMock(TransportRegistry);
    transportRegistry.get.mockReturnValue(transport);
    const moduleRef = await Test.createTestingModule({
      providers: [
        ChannelAnnouncer,
        { provide: ChatGateway, useValue: chatGateway },
        { provide: LoggingService, useValue: loggingService },
        { provide: RosterService, useValue: rosterService },
        { provide: TransportRegistry, useValue: transportRegistry }
      ]
    }).compile();
    channelAnnouncer = moduleRef.get(ChannelAnnouncer);
  });

  it('should post as the system bot and edit through the same account', async () => {
    const announced = await channelAnnouncer.announce('channel-1', '🟢 Resumed');
    expect(chatGateway.postAsSystemIn).toHaveBeenCalledWith('channel-1', '🟢 Resumed');
    expect(announced).toMatchObject({ authorUsername: 'collegium', createdAt: new Date(1000), postId: 'post-1' });
    await announced?.edit('🟢 Resumed, twice');
    expect(chatGateway.updateSystemPost).toHaveBeenCalledWith('post-1', { text: '🟢 Resumed, twice' });
  });

  it('should speak as the one agent present in a DM, without trying the system bot first (§7.5)', async () => {
    rosterService.isDirectMessage.mockReturnValue(true);
    rosterService.listAgentsIn.mockReturnValue([{ username: 'mira' } as AgentProfile]);
    const announced = await channelAnnouncer.announce('dm-1', '⏹️ Stopped `mira` before any further tool call.');
    expect(chatGateway.postAsSystemIn).not.toHaveBeenCalled();
    expect(announced).toMatchObject({ authorKind: 'agent', authorUsername: 'mira', postId: 'post-2' });
  });

  it('should fall back to the system bot when the agent cannot post in its own DM', async () => {
    rosterService.isDirectMessage.mockReturnValue(true);
    rosterService.listAgentsIn.mockReturnValue([{ username: 'mira' } as AgentProfile]);
    transport.send.mockResolvedValue(Result.err({ kind: 'api', message: 'socket down' }));
    const announced = await channelAnnouncer.announce('dm-1', 'notice');
    expect(announced).toMatchObject({ authorKind: 'system', postId: 'post-1' });
    expect(loggingService.error).not.toHaveBeenCalled();
  });

  it('should speak as the one agent present when the system bot cannot reach the channel', async () => {
    chatGateway.postAsSystemIn.mockResolvedValue(Result.err({ kind: 'api', message: 'not a member' }));
    rosterService.listAgentsIn.mockReturnValue([{ username: 'mira' } as AgentProfile]);
    const announced = await channelAnnouncer.announce('dm-1', '⏹️ Stopping 1 turn(s).');
    expect(transport.send).toHaveBeenCalledWith({ channelId: 'dm-1', text: '⏹️ Stopping 1 turn(s).' });
    expect(announced).toMatchObject({ authorUsername: 'mira', postId: 'post-2' });
    await announced?.edit('⏹️ Stopped.');
    expect(transport.updatePost).toHaveBeenCalledWith('post-2', { text: '⏹️ Stopped.' });
    expect(loggingService.error).not.toHaveBeenCalled();
  });

  it('should log and answer nothing when more than one agent is present and the system bot is refused', async () => {
    chatGateway.postAsSystemIn.mockResolvedValue(Result.err({ kind: 'api', message: 'refused' }));
    rosterService.listAgentsIn.mockReturnValue([{ username: 'mira' }, { username: 'jo' }] as AgentProfile[]);
    expect(await channelAnnouncer.announce('channel-1', 'notice')).toBeUndefined();
    expect(transport.send).not.toHaveBeenCalled();
    expect(loggingService.error).toHaveBeenCalledOnce();
  });

  it("should log and answer nothing when the agent's own post is refused too", async () => {
    chatGateway.postAsSystemIn.mockResolvedValue(Result.err({ kind: 'api', message: 'refused' }));
    rosterService.listAgentsIn.mockReturnValue([{ username: 'mira' } as AgentProfile]);
    transport.send.mockResolvedValue(Result.err({ kind: 'api', message: 'socket down' }));
    expect(await channelAnnouncer.announce('dm-1', 'notice')).toBeUndefined();
    expect(loggingService.error).toHaveBeenCalledOnce();
  });
});
