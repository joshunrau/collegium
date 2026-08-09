import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { ChatGateway } from '@/chat/chat.gateway.ts';
import type { RegisteredSlashCommand } from '@/chat/chat.types.ts';
import { EnvService } from '@/config/env/env.service.ts';
import { LoggingService } from '@/logging/logging.service.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';

import { COMMAND_DEFINITIONS, COMMAND_TRIGGERS } from '../../commands.definitions.ts';
import { CommandReconcilerService } from '../command-reconciler.service.ts';

import type { CommandTrigger } from '../../commands.definitions.ts';

const OWN_USER_ID = 'system-bot';
const CALLBACK_URL = 'https://collegium.example.com/commands';

const held = (trigger: CommandTrigger, overrides: Partial<RegisteredSlashCommand> = {}): RegisteredSlashCommand => ({
  autoComplete: true,
  autoCompleteHint: COMMAND_DEFINITIONS[trigger].hint,
  creatorId: OWN_USER_ID,
  creatorUsername: 'collegium',
  description: COMMAND_DEFINITIONS[trigger].purpose,
  displayName: trigger,
  id: `cmd-${trigger}`,
  method: 'P',
  trigger,
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

  it('should create every declared trigger against the callback url when the team holds none', async () => {
    surface([]);
    await commandReconcilerService.reconcile();
    expect(chatGateway.createSlashCommand).toHaveBeenCalledTimes(COMMAND_TRIGGERS.length);
    expect(chatGateway.createSlashCommand).toHaveBeenCalledWith({
      autoCompleteHint: '',
      description: COMMAND_DEFINITIONS.stop.purpose,
      displayName: 'stop',
      trigger: 'stop',
      url: CALLBACK_URL
    });
    expect(loggingService.log).toHaveBeenCalledWith(
      `reconciled ${COMMAND_TRIGGERS.length} slash commands: ${COMMAND_TRIGGERS.length} created, 0 corrected, 0 removed`
    );
  });

  it('should change nothing when every declared trigger is already current', async () => {
    surface(COMMAND_TRIGGERS.map((trigger) => held(trigger)));
    await commandReconcilerService.reconcile();
    expect(chatGateway.createSlashCommand).not.toHaveBeenCalled();
    expect(chatGateway.correctSlashCommand).not.toHaveBeenCalled();
    expect(chatGateway.deleteSlashCommand).not.toHaveBeenCalled();
    expect(loggingService.log).toHaveBeenCalledWith(
      `reconciled ${COMMAND_TRIGGERS.length} slash commands: all current`
    );
  });

  it('should correct a drifted trigger and remove one the app no longer declares', async () => {
    const orphan = { ...held('stop'), id: 'cmd-warp', trigger: 'warp' };
    surface([
      ...COMMAND_TRIGGERS.map((trigger) =>
        trigger === 'stop' ? held(trigger, { url: 'https://old-host.example.com/commands' }) : held(trigger)
      ),
      orphan
    ]);
    await commandReconcilerService.reconcile();
    expect(chatGateway.deleteSlashCommand).toHaveBeenCalledWith('cmd-warp');
    expect(chatGateway.correctSlashCommand).toHaveBeenCalledWith(
      'cmd-stop',
      expect.objectContaining({ url: CALLBACK_URL })
    );
    expect(chatGateway.createSlashCommand).not.toHaveBeenCalled();
    expect(loggingService.log).toHaveBeenCalledWith(
      `reconciled ${COMMAND_TRIGGERS.length} slash commands: 0 created, 1 corrected, 1 removed`
    );
  });

  it('should refuse boot naming a declared trigger held by an account it does not own', async () => {
    surface([held('stop', { creatorId: 'other-bot', creatorUsername: 'jira' })]);
    await expect(commandReconcilerService.reconcile()).rejects.toThrow('/stop (created by @jira)');
    expect(chatGateway.createSlashCommand).not.toHaveBeenCalled();
    expect(chatGateway.deleteSlashCommand).not.toHaveBeenCalled();
  });

  it('should fail loudly when it lacks authority to read the team’s slash commands', async () => {
    chatGateway.snapshotSlashCommandSurface.mockRejectedValue(new Error('403 forbidden'));
    await expect(commandReconcilerService.reconcile()).rejects.toThrow('403 forbidden');
  });
});
