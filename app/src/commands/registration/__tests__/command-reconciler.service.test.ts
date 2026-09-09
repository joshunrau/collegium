import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { ChatGateway } from '@/chat/chat.gateway.ts';
import { EnvService } from '@/config/env/env.service.ts';
import { LoggingService } from '@/logging/logging.service.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';

import { COMMAND_DEFINITIONS, COMMAND_TRIGGERS } from '../../commands.definitions.ts';
import { CommandReconcilerService } from '../command-reconciler.service.ts';

describe('CommandReconcilerService', () => {
  let commandReconcilerService: CommandReconcilerService;
  let chatGateway: MockedInstance<ChatGateway>;
  let loggingService: MockedInstance<LoggingService>;

  beforeEach(async () => {
    // a public URL with a trailing slash must not compose a double-slashed callback
    const envService = MockFactory.createMock(EnvService);
    envService.get.mockReturnValue('https://collegium.example.com/');
    const moduleRef = await Test.createTestingModule({
      providers: [
        CommandReconcilerService,
        MockFactory.createForService(ChatGateway),
        { provide: EnvService, useValue: envService },
        MockFactory.createForService(LoggingService)
      ]
    }).compile();
    commandReconcilerService = moduleRef.get(CommandReconcilerService);
    chatGateway = moduleRef.get(ChatGateway);
    loggingService = moduleRef.get(LoggingService);
    chatGateway.deleteOwnedSlashCommands.mockResolvedValue(0);
  });

  it('should declare every subcommand against the callback url', async () => {
    await commandReconcilerService.reconcile();
    expect(chatGateway.declareCommandSurface).toHaveBeenCalledExactlyOnceWith({
      callbackUrl: 'https://collegium.example.com/commands',
      commands: COMMAND_TRIGGERS.map((trigger) => ({ ...COMMAND_DEFINITIONS[trigger], trigger }))
    });
    expect(loggingService.log).toHaveBeenCalledWith(`declared /collegium with ${COMMAND_TRIGGERS.length} subcommands`);
  });

  it('should remove the dotted commands a release before the plugin registered', async () => {
    chatGateway.deleteOwnedSlashCommands.mockResolvedValue(10);
    await commandReconcilerService.reconcile();
    expect(loggingService.log).toHaveBeenCalledWith(
      `declared /collegium with ${COMMAND_TRIGGERS.length} subcommands, removed 10 relic slash command(s)`
    );
  });

  it('should refuse boot when the plugin refuses the declaration', async () => {
    chatGateway.declareCommandSurface.mockRejectedValue(new Error('the Collegium plugin is not installed'));
    await expect(commandReconcilerService.reconcile()).rejects.toThrow('not installed');
    expect(chatGateway.deleteOwnedSlashCommands).not.toHaveBeenCalled();
  });
});
