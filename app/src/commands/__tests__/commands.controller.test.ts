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
    expect(() => new CommandRegistry(incomplete)).toThrow('/collegium stop');
  });

  it('should refuse two handlers claiming one trigger', () => {
    const doubled = [...COMMAND_TRIGGERS.map(createHandlerStub), createHandlerStub('stop')];
    expect(() => new CommandRegistry(doubled)).toThrow('/collegium stop');
  });

  it('should resolve the leading subcommand and hand the rest to its handler', () => {
    const registry = new CommandRegistry(COMMAND_TRIGGERS.map(createHandlerStub));
    const resolved = registry.resolve('  memory mira  prune ref-1 ');
    expect(resolved?.handler.trigger).toBe('memory');
    expect(resolved?.text).toBe('mira prune ref-1');
    expect(registry.resolve('')).toBeUndefined();
    expect(registry.resolve('/collegium stop')).toBeUndefined();
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

  it('should bind the parsed body and dispatch to the subcommand’s handler', async () => {
    const response = await commandsController.handle({
      channel_id: 'channel-1',
      text: 'memory mira prune ref-1',
      user_name: 'casey'
    });
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ trigger: 'memory' }), {
      channelId: 'channel-1',
      text: 'mira prune ref-1',
      username: 'casey'
    });
    expect(response).toStrictEqual({ response_type: 'ephemeral', text: 'stopping' });
  });

  it('should answer a bare or unknown subcommand with the surface usage', async () => {
    const response = await commandsController.handle({ channel_id: 'channel-1', text: 'halt', user_name: 'casey' });
    expect(response.response_type).toBe('ephemeral');
    expect(response.text).toContain('Usage: /collegium {subcommand}');
    expect(response.text).toContain('- /collegium stop — Abort current turns');
    expect(run).not.toHaveBeenCalled();
  });
});
