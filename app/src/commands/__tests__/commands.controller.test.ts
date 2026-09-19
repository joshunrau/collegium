import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import { CallbackTokenGuard } from '@/chat/callback-auth/callback-token.guard.ts';
import { EnvService } from '@/config/env/env.service.ts';
import { createEnvServiceMock } from '@/testing/factories/env-service.factory.ts';

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
  let execute: Mock<(input: CommandInput) => Promise<{ responseType: string; text: string }>>;

  beforeEach(async () => {
    execute = vi.fn(() => Promise.resolve({ responseType: 'ephemeral', text: 'stopping' }));
    const moduleRef = await Test.createTestingModule({
      controllers: [CommandsController],
      providers: [
        { provide: CommandsService, useValue: { execute } },
        { provide: EnvService, useValue: createEnvServiceMock() }
      ]
    }).compile();
    commandsController = moduleRef.get(CommandsController);
  });

  it('should bind the parsed body and delegate to the service', async () => {
    const response = await commandsController.handle({
      channel_id: 'channel-1',
      text: 'memory mira prune ref-1',
      user_id: 'casey-id',
      user_name: 'casey'
    });
    expect(execute).toHaveBeenCalledExactlyOnceWith({
      channelId: 'channel-1',
      text: 'memory mira prune ref-1',
      triggerId: undefined,
      userId: 'casey-id',
      username: 'casey'
    });
    expect(response).toStrictEqual({ response_type: 'ephemeral', text: 'stopping' });
  });

  it('should carry the trigger id the plugin forwards, and none when it forwards an empty one (§8.5)', async () => {
    await commandsController.handle({
      channel_id: 'channel-1',
      text: 'clear',
      trigger_id: 'trigger-1',
      user_id: 'casey-id',
      user_name: 'casey'
    });
    expect(execute).toHaveBeenLastCalledWith(expect.objectContaining({ triggerId: 'trigger-1' }));
    await commandsController.handle({
      channel_id: 'channel-1',
      text: 'clear',
      trigger_id: '',
      user_id: 'casey-id',
      user_name: 'casey'
    });
    expect(execute).toHaveBeenLastCalledWith(expect.objectContaining({ triggerId: undefined }));
  });

  it('should stand behind the callback token guard, so no body is read without it (§6.4)', () => {
    expect(Reflect.getMetadata('__guards__', CommandsController)).toStrictEqual([CallbackTokenGuard]);
  });

  it('should refuse a body without the fields the plugin forwards', async () => {
    await expect(commandsController.handle({ text: 'stop' })).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });

  it('should refuse a forwarded command carrying no user id (§3.7)', async () => {
    await expect(
      commandsController.handle({ channel_id: 'channel-1', text: 'approvals', user_name: 'casey' })
    ).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });
});
