import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { $Config, AgentDefinition } from '@collegium/config';
import { Test } from '@nestjs/testing';
import type { PartialDeep } from 'type-fest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ActivationService } from '@/activation/activation.service.ts';
import { AgentRegistry } from '@/agents/agents.registry.ts';
import type { AgentProfile } from '@/agents/agents.types.ts';
import { RosterService } from '@/channels/roster/roster.service.ts';
import { ChatGateway } from '@/chat/chat.gateway.ts';
import { ChatTransport } from '@/chat/chat.transport.ts';
import type { ChatEvent, ChatEventHandler } from '@/chat/chat.types.ts';
import { TransportRegistry } from '@/chat/transports/transport.registry.ts';
import { CommandReconcilerService } from '@/commands/registration/command-reconciler.service.ts';
import { ConfigService } from '@/config/config.service.ts';
import { ResyncService } from '@/conversations/resync/resync.service.ts';
import { CredentialsService } from '@/credentials/credentials.service.ts';
import { HaltService } from '@/halt/halt.service.ts';
import { LoggingService } from '@/logging/logging.service.ts';
import { MailBootService } from '@/mail/boot/boot.service.ts';
import { MailInboundService } from '@/mail/inbound/inbound.service.ts';
import { NotificationsService } from '@/notifications/notifications.service.ts';
import { ShellService } from '@/shell/shell.service.ts';
import { createConfigServiceMock } from '@/testing/factories/config-service.factory.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';
import { createObservedPost } from '@/testing/factories/observed-post.factory.ts';
import { TriggersService } from '@/triggers/triggers.service.ts';

import { BootService } from '../boot/boot.service.ts';
import { RuntimeService } from '../runtime.service.ts';

const DEFINITION: AgentDefinition = {
  contextBudgetTokens: 8000,
  expertise: 'testing',
  model: { name: 'deepseek-v4-flash', provider: 'deepseek' },
  skills: [],
  systemPrompt: 'You are Mira.',
  tools: [],
  toolSettings: {},
  username: 'mira'
};

const MEMBERSHIP_EVENT: ChatEvent.Membership = {
  agentUsername: 'mira',
  channelId: 'channel-1',
  kind: 'user_added_to_channel'
};

describe('RuntimeService', () => {
  let activationService: MockedInstance<ActivationService>;
  let agentRegistry: MockedInstance<AgentRegistry>;
  let bootService: MockedInstance<BootService>;
  let chatGateway: MockedInstance<ChatGateway>;
  let commandReconcilerService: MockedInstance<CommandReconcilerService>;
  let credentialsService: MockedInstance<CredentialsService>;
  let haltService: MockedInstance<HaltService>;
  let notificationsService: MockedInstance<NotificationsService>;
  let resyncService: MockedInstance<ResyncService>;
  let rosterService: MockedInstance<RosterService>;
  let shellService: MockedInstance<ShellService>;
  let transport: MockedInstance<ChatTransport>;
  let transportRegistry: MockedInstance<TransportRegistry>;
  let triggersService: MockedInstance<TriggersService>;
  let handleEvent: ChatEventHandler;
  let mira: AgentProfile;
  let workspaceRoot: string;

  const compile = (overrides: PartialDeep<$Config> = {}): Promise<RuntimeService> =>
    Test.createTestingModule({
      providers: [
        RuntimeService,
        { provide: ActivationService, useValue: activationService },
        { provide: AgentRegistry, useValue: agentRegistry },
        { provide: BootService, useValue: bootService },
        { provide: ChatGateway, useValue: chatGateway },
        { provide: CredentialsService, useValue: credentialsService },
        { provide: CommandReconcilerService, useValue: commandReconcilerService },
        {
          provide: ConfigService,
          useValue: createConfigServiceMock({ agents: { mira: DEFINITION }, ...overrides })
        },
        { provide: HaltService, useValue: haltService },
        MockFactory.createForService(LoggingService),
        MockFactory.createForService(MailBootService),
        MockFactory.createForService(MailInboundService),
        { provide: NotificationsService, useValue: notificationsService },
        { provide: ResyncService, useValue: resyncService },
        { provide: RosterService, useValue: rosterService },
        { provide: ShellService, useValue: shellService },
        { provide: TransportRegistry, useValue: transportRegistry },
        { provide: TriggersService, useValue: triggersService }
      ]
    })
      .compile()
      .then((moduleRef) => moduleRef.get(RuntimeService));

  beforeEach(() => {
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'collegium-runtime-'));
    mira = {
      contextBudgetTokens: 1000,
      expertise: 'testing',
      model: { name: 'deepseek-v4-flash', provider: 'deepseek' },
      skills: [],
      systemPrompt: 'You are Mira.',
      tools: [],
      toolSettings: new Map(),
      username: 'mira',
      workspaceDir: path.join(workspaceRoot, 'mira')
    };
    activationService = MockFactory.createMock(ActivationService);
    agentRegistry = MockFactory.createMock(AgentRegistry);
    agentRegistry.list.mockReturnValue([mira]);
    agentRegistry.get.mockReturnValue(mira);
    bootService = MockFactory.createMock(BootService);
    bootService.run.mockResolvedValue({ abandonedTurns: 2, downSince: new Date(1000) });
    transport = MockFactory.createMock(ChatTransport);
    transport.listen.mockImplementation((onEvent) => {
      handleEvent = onEvent;
    });
    chatGateway = MockFactory.createMock(ChatGateway);
    chatGateway.connect.mockResolvedValue(transport);
    commandReconcilerService = MockFactory.createMock(CommandReconcilerService);
    credentialsService = MockFactory.createMock(CredentialsService);
    credentialsService.require.mockImplementation((username: string) => Promise.resolve(`${username}-token`));
    haltService = MockFactory.createMock(HaltService);
    notificationsService = MockFactory.createMock(NotificationsService);
    resyncService = MockFactory.createMock(ResyncService);
    resyncService.recover.mockResolvedValue([]);
    rosterService = MockFactory.createMock(RosterService);
    shellService = MockFactory.createMock(ShellService);
    shellService.assertProvisioned.mockResolvedValue(undefined);
    transportRegistry = MockFactory.createMock(TransportRegistry);
    triggersService = MockFactory.createMock(TriggersService);
  });

  afterEach(() => {
    fs.rmSync(workspaceRoot, { force: true, recursive: true });
  });

  it('should reconcile the command surface before connecting any agent (§8.4)', async () => {
    const runtimeService = await compile();
    commandReconcilerService.reconcile.mockImplementation(() => {
      expect(chatGateway.connect).not.toHaveBeenCalled();
      return Promise.resolve();
    });
    await runtimeService.onApplicationBootstrap();
    expect(commandReconcilerService.reconcile).toHaveBeenCalledOnce();
  });

  it('should create each agent workspace private to the process (§6.1)', async () => {
    const runtimeService = await compile();
    await runtimeService.onApplicationBootstrap();
    const stats = fs.statSync(mira.workspaceDir);
    expect(stats.isDirectory()).toBe(true);
    expect(stats.mode & 0o077).toBe(0);
  });

  it('should connect each configured agent and register its transport', async () => {
    const runtimeService = await compile();
    await runtimeService.onApplicationBootstrap();
    expect(chatGateway.connect).toHaveBeenCalledExactlyOnceWith({ agent: mira, botToken: 'mira-token' });
    expect(transportRegistry.register).toHaveBeenCalledExactlyOnceWith('mira', transport);
  });

  it('should refuse to start an agent that has no registered profile', async () => {
    agentRegistry.get.mockReturnValue(undefined);
    const runtimeService = await compile();
    await expect(runtimeService.onApplicationBootstrap()).rejects.toThrow('no profile registered for agent "mira"');
  });

  it('should announce coming online with the boot report (§7.3)', async () => {
    const runtimeService = await compile();
    await runtimeService.onApplicationBootstrap();
    expect(notificationsService.notify).toHaveBeenCalledExactlyOnceWith({
      abandonedTurns: 2,
      agentUsernames: ['mira'],
      downSince: new Date(1000),
      kind: 'online'
    });
  });

  it('should stay silent on boot when lifecycle notifications are disabled', async () => {
    const runtimeService = await compile({ notifications: { lifecycle: false } });
    await runtimeService.onApplicationBootstrap();
    expect(notificationsService.notify).not.toHaveBeenCalled();
  });

  it('should flush pending triggers for the channel a trigger was recorded in', async () => {
    const runtimeService = await compile();
    await runtimeService.onApplicationBootstrap();
    const onRecorded = triggersService.onRecorded.mock.calls[0]?.[0];
    onRecorded?.('channel-1');
    expect(activationService.flushTriggersIfIdle).toHaveBeenCalledExactlyOnceWith('channel-1');
  });

  it('should disconnect every running transport on shutdown', async () => {
    const runtimeService = await compile();
    await runtimeService.onApplicationBootstrap();
    runtimeService.onApplicationShutdown();
    expect(transport.disconnect).toHaveBeenCalledOnce();
  });

  it('should hand a posted event to activation', async () => {
    const post = createObservedPost();
    const runtimeService = await compile();
    await runtimeService.onApplicationBootstrap();
    await handleEvent({ kind: 'posted', post });
    expect(activationService.onPost).toHaveBeenCalledExactlyOnceWith(mira, post);
  });

  // §7.3/§4.5 — the roster is empty until it reconciles, so a post evaluated during boot slips the
  // multi-mention refusal; the socket stays live all the same, so nothing goes unobserved
  it('should hold an event that arrives during boot until the sweep has finished', async () => {
    const post = createObservedPost();
    let finishBoot!: () => void;
    bootService.run.mockReturnValue(
      new Promise((resolve) => (finishBoot = () => resolve({ abandonedTurns: 0, downSince: undefined })))
    );
    const runtimeService = await compile();
    const booting = runtimeService.onApplicationBootstrap();
    await vi.waitFor(() => expect(transport.listen).toHaveBeenCalled());
    await handleEvent({ kind: 'posted', post });
    expect(activationService.onPost).not.toHaveBeenCalled();
    finishBoot();
    await booting;
    expect(activationService.onPost).toHaveBeenCalledWith(mira, post);
  });

  it('should record a membership event without halting when the topology holds', async () => {
    rosterService.onMembershipEvent.mockReturnValue(undefined);
    const runtimeService = await compile();
    await runtimeService.onApplicationBootstrap();
    await handleEvent(MEMBERSHIP_EVENT);
    expect(rosterService.onMembershipEvent).toHaveBeenCalledExactlyOnceWith(MEMBERSHIP_EVENT);
    expect(haltService.halt).not.toHaveBeenCalled();
    expect(activationService.onPost).not.toHaveBeenCalled();
  });

  it('should halt when a membership event breaks the one-agent rule (§3.10)', async () => {
    rosterService.onMembershipEvent.mockReturnValue({
      agentUsernames: ['mira', 'robin'],
      channelId: 'channel-1'
    });
    const runtimeService = await compile();
    await runtimeService.onApplicationBootstrap();
    await handleEvent(MEMBERSHIP_EVENT);
    expect(haltService.halt).toHaveBeenCalledExactlyOnceWith({
      agentUsernames: ['mira', 'robin'],
      channelId: 'channel-1',
      kind: 'topology-violation'
    });
  });
});
