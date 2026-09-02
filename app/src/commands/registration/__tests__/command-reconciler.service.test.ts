import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { ChatGateway } from '@/chat/chat.gateway.ts';
import type { RegisteredSlashCommand } from '@/chat/chat.types.ts';
import { EnvService } from '@/config/env/env.service.ts';
import { LoggingService } from '@/logging/logging.service.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';

import { COMMAND_DESCRIPTION, COMMAND_TRIGGER, renderAutocompleteHint } from '../../commands.definitions.ts';
import { CommandReconcilerService } from '../command-reconciler.service.ts';

const OWN_USER_ID = 'system-bot';
const CALLBACK_URL = 'https://collegium.example.com/commands';

const held = (overrides: Partial<RegisteredSlashCommand> = {}): RegisteredSlashCommand => ({
  autoComplete: true,
  autoCompleteHint: renderAutocompleteHint(),
  creatorId: OWN_USER_ID,
  creatorUsername: 'collegium',
  description: COMMAND_DESCRIPTION,
  displayName: COMMAND_TRIGGER,
  id: 'cmd-collegium',
  method: 'P',
  trigger: COMMAND_TRIGGER,
  url: CALLBACK_URL,
  ...overrides
});

describe('CommandReconcilerService', () => {
  let commandReconcilerService: CommandReconcilerService;
  let chatGateway: MockedInstance<ChatGateway>;
  let loggingService: MockedInstance<LoggingService>;

  const surface = (commands: readonly RegisteredSlashCommand[]) => {
    chatGateway.snapshotSlashCommandSurface.mockResolvedValue({ commands, ownUserId: OWN_USER_ID });
  };

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
  });

  it('should create the single collegium command when the team holds none', async () => {
    surface([]);
    await commandReconcilerService.reconcile();
    expect(chatGateway.createSlashCommand).toHaveBeenCalledTimes(1);
    expect(chatGateway.createSlashCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        description: COMMAND_DESCRIPTION,
        displayName: COMMAND_TRIGGER,
        trigger: COMMAND_TRIGGER,
        url: CALLBACK_URL
      })
    );
    expect(loggingService.log).toHaveBeenCalledWith(
      `reconciled /${COMMAND_TRIGGER}: 1 created, 0 corrected, 0 removed`
    );
  });

  it('should change nothing when the command is already current', async () => {
    surface([held()]);
    await commandReconcilerService.reconcile();
    expect(chatGateway.createSlashCommand).not.toHaveBeenCalled();
    expect(chatGateway.correctSlashCommand).not.toHaveBeenCalled();
    expect(chatGateway.deleteSlashCommand).not.toHaveBeenCalled();
    expect(loggingService.log).toHaveBeenCalledWith(`reconciled /${COMMAND_TRIGGER}: current`);
  });

  it('should correct a drifted command and remove orphaned per-trigger commands', async () => {
    const orphan: RegisteredSlashCommand = {
      ...held(),
      id: 'cmd-stop',
      trigger: 'stop'
    };
    surface([held({ url: 'https://old-host.example.com/commands' }), orphan]);
    await commandReconcilerService.reconcile();
    expect(chatGateway.deleteSlashCommand).toHaveBeenCalledWith('cmd-stop');
    expect(chatGateway.correctSlashCommand).toHaveBeenCalledWith(
      'cmd-collegium',
      expect.objectContaining({ url: CALLBACK_URL })
    );
    expect(chatGateway.createSlashCommand).not.toHaveBeenCalled();
    expect(loggingService.log).toHaveBeenCalledWith(
      `reconciled /${COMMAND_TRIGGER}: 0 created, 1 corrected, 1 removed`
    );
  });

  it('should refuse boot when the trigger is held by an account it does not own', async () => {
    surface([held({ creatorId: 'other-bot', creatorUsername: 'jira' })]);
    await expect(commandReconcilerService.reconcile()).rejects.toThrow(`/${COMMAND_TRIGGER} (created by @jira)`);
    expect(chatGateway.createSlashCommand).not.toHaveBeenCalled();
    expect(chatGateway.deleteSlashCommand).not.toHaveBeenCalled();
  });

  it("should fail loudly when it lacks authority to read the team's slash commands", async () => {
    chatGateway.snapshotSlashCommandSurface.mockRejectedValue(new Error('403 forbidden'));
    await expect(commandReconcilerService.reconcile()).rejects.toThrow('403 forbidden');
  });
});
