import { Result } from '@collegium/core/utils';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import type { AgentProfile } from '@/agents/agents.types.ts';
import { RosterService } from '@/channels/roster/roster.service.ts';
import { ChatGateway } from '@/chat/chat.gateway.ts';
import { ChatTransport } from '@/chat/chat.transport.ts';
import { TransportRegistry } from '@/chat/transports/transport.registry.ts';
import { LoggingService } from '@/logging/logging.service.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';

import { CommandRegistry } from '../commands.registry.ts';
import { CommandsService } from '../commands.service.ts';

import type { CommandHandler } from '../commands.handler.ts';
import type { CommandInput, CommandResponse } from '../commands.types.ts';

const INPUT = { channelId: 'channel-1', text: 'resume', username: 'casey' };

describe('CommandsService', () => {
  let chatGateway: MockedInstance<ChatGateway>;
  let commandRegistry: MockedInstance<CommandRegistry>;
  let commandsService: CommandsService;
  let handle: Mock<(input: CommandInput) => Promise<CommandResponse>>;
  let loggingService: MockedInstance<LoggingService>;
  let rosterService: MockedInstance<RosterService>;
  let transport: MockedInstance<ChatTransport>;

  beforeEach(async () => {
    chatGateway = MockFactory.createMock(ChatGateway);
    chatGateway.postAsSystemIn.mockResolvedValue(
      Result.ok({ authorUsername: 'collegium', createdAt: new Date(0), postId: 'post-1' })
    );
    commandRegistry = MockFactory.createMock(CommandRegistry);
    loggingService = MockFactory.createMock(LoggingService);
    rosterService = MockFactory.createMock(RosterService);
    rosterService.listAgentsIn.mockReturnValue([]);
    transport = MockFactory.createMock(ChatTransport);
    transport.send.mockResolvedValue(Result.ok({ createdAt: new Date(0), postId: 'post-2' }));
    const transportRegistry = MockFactory.createMock(TransportRegistry);
    transportRegistry.get.mockReturnValue(transport);
    const moduleRef = await Test.createTestingModule({
      providers: [
        CommandsService,
        { provide: ChatGateway, useValue: chatGateway },
        { provide: CommandRegistry, useValue: commandRegistry },
        { provide: LoggingService, useValue: loggingService },
        { provide: RosterService, useValue: rosterService },
        { provide: TransportRegistry, useValue: transportRegistry }
      ]
    }).compile();
    commandsService = moduleRef.get(CommandsService);
  });

  const dispatch = (response: CommandResponse, input = INPUT) => {
    handle = vi.fn(() => Promise.resolve(response));
    const handler: CommandHandler = { handle, trigger: 'resume' };
    commandRegistry.resolve.mockImplementation((trigger) => (trigger === 'resume' ? handler : undefined));
    return commandsService.dispatch(input);
  };

  it('should route the first token to its handler with the rest as the handler’s text', async () => {
    await dispatch({ audience: 'invoker', text: 'ok' }, { ...INPUT, text: ' resume  now ' });
    expect(handle).toHaveBeenCalledWith({ ...INPUT, text: 'now' });
  });

  it('should answer a bare /collegium with the subcommand listing', async () => {
    const result = await dispatch({ audience: 'invoker', text: 'ok' }, { ...INPUT, text: '' });
    expect(handle).not.toHaveBeenCalled();
    expect(result.responseType).toBe('ephemeral');
    expect(result.text).toContain('Usage: /collegium {subcommand}');
    expect(result.text).toContain('- resume — Clear a global halt');
  });

  it('should name an unknown subcommand before the listing', async () => {
    const result = await dispatch({ audience: 'invoker', text: 'ok' }, { ...INPUT, text: 'warp' });
    expect(result.text).toMatch(/^Unknown subcommand "warp"\.\n/);
    expect(result.text).toContain('Usage: /collegium {subcommand}');
  });

  it('should post channel output as the system bot rather than as the invoker', async () => {
    const response = await dispatch({ audience: 'channel', text: '🟢 Resumed' });
    expect(chatGateway.postAsSystemIn).toHaveBeenCalledWith('channel-1', '🟢 Resumed');
    expect(response.text).toBe('');
  });

  it('should hold announced work until the announcement is posted', async () => {
    const afterAnnouncing = vi.fn(() => Promise.resolve());
    await dispatch({ afterAnnouncing, audience: 'channel', text: '🟢 Resumed' });
    expect(afterAnnouncing).toHaveBeenCalledAfter(chatGateway.postAsSystemIn);
  });

  it('should leave invoker output ephemeral, posting nothing', async () => {
    const response = await dispatch({ audience: 'invoker', text: 'Nothing here.' });
    expect(response).toStrictEqual({ responseType: 'ephemeral', text: 'Nothing here.' });
    expect(chatGateway.postAsSystemIn).not.toHaveBeenCalled();
  });

  it('should log a refused announcement rather than failing the command', async () => {
    chatGateway.postAsSystemIn.mockResolvedValue(Result.err({ kind: 'api', message: 'refused' }));
    await dispatch({ audience: 'channel', text: '🟢 Resumed' });
    expect(loggingService.error).toHaveBeenCalledOnce();
  });

  // §7.5 — Mattermost admits no third party to a DM, so the system bot can never post there and the
  // notice would be the interrupt's only record
  it('should post under the one agent present when the system bot cannot reach the channel', async () => {
    chatGateway.postAsSystemIn.mockResolvedValue(Result.err({ kind: 'api', message: 'not a member' }));
    rosterService.listAgentsIn.mockReturnValue([{ username: 'mira' } as AgentProfile]);
    const response = await dispatch({ audience: 'channel', text: '⏹️ Stopping 1 turn(s).' });
    expect(transport.send).toHaveBeenCalledWith({ channelId: 'channel-1', text: '⏹️ Stopping 1 turn(s).' });
    expect(response.text).toBe('');
    expect(loggingService.error).not.toHaveBeenCalled();
  });

  it('should tell the invoker what no channel could be told', async () => {
    chatGateway.postAsSystemIn.mockResolvedValue(Result.err({ kind: 'api', message: 'refused' }));
    const response = await dispatch({ audience: 'channel', text: '⏹️ Killed 1 turn(s).' });
    expect(response).toStrictEqual({ responseType: 'ephemeral', text: '⏹️ Killed 1 turn(s).' });
  });
});
