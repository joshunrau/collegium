import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import { CommandsController } from '../commands.controller.ts';
import { COMMAND_TRIGGERS } from '../commands.definitions.ts';
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
    expect(() => new CommandRegistry(incomplete)).toThrow('/collegium.stop');
  });

  it('should refuse two handlers claiming one trigger', () => {
    const doubled = [...COMMAND_TRIGGERS.map(createHandlerStub), createHandlerStub('stop')];
    expect(() => new CommandRegistry(doubled)).toThrow('/collegium.stop');
  });

  it('should resolve only the wire form Mattermost sends', () => {
    const registry = new CommandRegistry(COMMAND_TRIGGERS.map(createHandlerStub));
    expect(registry.resolve('/collegium.stop')?.trigger).toBe('stop');
    expect(registry.resolve('stop')).toBeUndefined();
    expect(registry.resolve('/stop')).toBeUndefined();
  });
});

describe('CommandsController', () => {
  let commandsController: CommandsController;
  let run: Mock<(handler: CommandHandler, input: CommandInput) => Promise<{ responseType: string; text: string }>>;

  beforeEach(async () => {
    run = vi.fn(() => Promise.resolve({ responseType: 'ephemeral', text: 'stopping' }));
    const moduleRef = await Test.createTestingModule({
      controllers: [CommandsController],
      providers: [
        { provide: CommandRegistry, useValue: new CommandRegistry(COMMAND_TRIGGERS.map(createHandlerStub)) },
        { provide: CommandsService, useValue: { run } }
      ]
    }).compile();
    commandsController = moduleRef.get(CommandsController);
  });

  it('should bind the parsed body and dispatch to the command’s handler', async () => {
    const response = await commandsController.handle({
      channel_id: 'channel-1',
      command: '/collegium.memory',
      text: 'mira prune ref-1',
      user_name: 'casey'
    });
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ trigger: 'memory' }), {
      channelId: 'channel-1',
      text: 'mira prune ref-1',
      username: 'casey'
    });
    expect(response).toStrictEqual({ response_type: 'ephemeral', text: 'stopping' });
  });

  it('should refuse a command no handler declares', async () => {
    await expect(
      commandsController.handle({ channel_id: 'channel-1', command: '/stop', text: '', user_name: 'casey' })
    ).rejects.toThrow(BadRequestException);
    expect(run).not.toHaveBeenCalled();
  });
});
