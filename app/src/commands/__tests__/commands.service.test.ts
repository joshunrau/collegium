import { Result } from '@collegium/core/utils';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChannelAnnouncer } from '@/notifications/announcing/channel-announcer.service.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';

import { CommandRegistry } from '../commands.registry.ts';
import { CommandsService } from '../commands.service.ts';

import type { CommandHandler } from '../commands.handler.ts';
import type { CommandResponse } from '../commands.types.ts';

const INPUT = { channelId: 'channel-1', text: 'resume', userId: 'casey-id', username: 'casey' };

const toHandler = (response: CommandResponse): CommandHandler => ({
  handle: () => Promise.resolve(response),
  trigger: 'resume'
});

describe('CommandsService', () => {
  let channelAnnouncer: MockedInstance<ChannelAnnouncer>;
  let commandRegistry: MockedInstance<CommandRegistry>;
  let commandsService: CommandsService;

  beforeEach(async () => {
    channelAnnouncer = MockFactory.createMock(ChannelAnnouncer);
    channelAnnouncer.announce.mockResolvedValue({
      authorUsername: 'collegium',
      createdAt: new Date(0),
      edit: () => Promise.resolve(Result.ok()),
      postId: 'post-1'
    });
    commandRegistry = MockFactory.createMock(CommandRegistry);
    const moduleRef = await Test.createTestingModule({
      providers: [
        CommandsService,
        { provide: ChannelAnnouncer, useValue: channelAnnouncer },
        { provide: CommandRegistry, useValue: commandRegistry }
      ]
    }).compile();
    commandsService = moduleRef.get(CommandsService);
  });

  /** runs the command with a handler answering as given, the registry having resolved it */
  const execute = (response: CommandResponse) => {
    commandRegistry.resolve.mockReturnValue({ handler: toHandler(response), text: '' });
    return commandsService.execute(INPUT);
  };

  it('should answer a subcommand nothing declares with the surface usage', async () => {
    commandRegistry.resolve.mockReturnValue(undefined);
    const response = await commandsService.execute({ ...INPUT, text: 'halt' });
    expect(response.responseType).toBe('ephemeral');
    expect(response.text).toContain('Usage: /collegium {subcommand}');
    expect(response.text).toContain('- /collegium stop — Abort current turns');
  });

  it('should announce channel output rather than answer as the invoker', async () => {
    const response = await execute({ audience: 'channel', text: '🟢 Resumed' });
    expect(channelAnnouncer.announce).toHaveBeenCalledWith('channel-1', '🟢 Resumed');
    expect(response.text).toBe('');
  });

  it('should hold announced work until the announcement is posted', async () => {
    const afterAnnouncing = vi.fn(() => Promise.resolve());
    await execute({ afterAnnouncing, audience: 'channel', text: '🟢 Resumed' });
    expect(afterAnnouncing).toHaveBeenCalledAfter(channelAnnouncer.announce);
  });

  it('should hand announced work the post it landed as, and withhold it when nothing landed (§3.15)', async () => {
    const onAnnounced = vi.fn(() => Promise.resolve());
    await execute({ audience: 'channel', onAnnounced, text: 'Unit cancelled' });
    expect(onAnnounced).toHaveBeenCalledExactlyOnceWith('post-1');
    channelAnnouncer.announce.mockResolvedValueOnce(undefined);
    const response = await execute({ audience: 'channel', onAnnounced, text: 'Unit cancelled' });
    expect(onAnnounced).toHaveBeenCalledOnce();
    expect(response.text).toBe('The announcement could not be posted in this channel, so nothing was changed.');
  });

  it('should leave invoker output ephemeral, posting nothing', async () => {
    const response = await execute({ audience: 'invoker', text: 'Nothing here.' });
    expect(response).toStrictEqual({ responseType: 'ephemeral', text: 'Nothing here.' });
    expect(channelAnnouncer.announce).not.toHaveBeenCalled();
  });

  it('should tell the invoker what no channel could be told', async () => {
    channelAnnouncer.announce.mockResolvedValue(undefined);
    const response = await execute({ audience: 'channel', text: '⏹️ Killed 1 turn(s).' });
    expect(response).toStrictEqual({ responseType: 'ephemeral', text: '⏹️ Killed 1 turn(s).' });
  });
});
