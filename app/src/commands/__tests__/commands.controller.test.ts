import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import { CommandsController } from '../commands.controller.ts';
import { COMMAND_TRIGGER, COMMAND_TRIGGERS } from '../commands.definitions.ts';
import { CommandRegistry } from '../commands.registry.ts';
import { CommandsService } from '../commands.service.ts';

import type { CommandTrigger } from '../commands.definitions.ts';
import type { CommandHandler } from '../commands.handler.ts';
import type { CommandInput } from '../commands.types.ts';

const createHandlerStub = (trigger: CommandTrigger): CommandHandler => ({
  handle: vi.fn(() => Promise.resolve({ audience: 'invoker' as const, text: `handled /${trigger}` })),
  trigger
});

describe('CommandRegistry', () => {
  it('should refuse to assemble without a handler for every declared trigger', () => {
    const incomplete = COMMAND_TRIGGERS.filter((trigger) => trigger !== 'stop').map(createHandlerStub);
    expect(() => new CommandRegistry(incomplete)).toThrow('/stop');
  });

  it('should refuse two handlers claiming one trigger', () => {
    const doubled = [...COMMAND_TRIGGERS.map(createHandlerStub), createHandlerStub('stop')];
    expect(() => new CommandRegistry(doubled)).toThrow('/stop');
  });

  it('should resolve a trigger by name', () => {
    const registry = new CommandRegistry(COMMAND_TRIGGERS.map(createHandlerStub));
    expect(registry.resolve('stop')?.trigger).toBe('stop');
    expect(registry.resolve('nonexistent')).toBeUndefined();
  });
});

describe('CommandsController', () => {
  let commandsController: CommandsController;
  let dispatch: Mock<(input: CommandInput) => Promise<{ responseType: string; text: string }>>;

  beforeEach(async () => {
    dispatch = vi.fn(() => Promise.resolve({ responseType: 'ephemeral', text: 'stopping' }));
    const moduleRef = await Test.createTestingModule({
      controllers: [CommandsController],
      providers: [{ provide: CommandsService, useValue: { dispatch } }]
    }).compile();
    commandsController = moduleRef.get(CommandsController);
  });

  it('should bind the parsed body and delegate the text after the trigger', async () => {
    const response = await commandsController.handle({
      channel_id: 'channel-1',
      command: `/${COMMAND_TRIGGER}`,
      text: 'memory mira prune ref-1',
      user_name: 'casey'
    });
    expect(dispatch).toHaveBeenCalledWith({
      channelId: 'channel-1',
      text: 'memory mira prune ref-1',
      username: 'casey'
    });
    expect(response).toStrictEqual({ response_type: 'ephemeral', text: 'stopping' });
  });

  it('should refuse a command that is not the registered trigger', async () => {
    await expect(
      commandsController.handle({ channel_id: 'channel-1', command: '/warp', text: '', user_name: 'casey' })
    ).rejects.toThrow(BadRequestException);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
