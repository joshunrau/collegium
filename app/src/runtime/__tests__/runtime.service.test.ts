import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { $Config, AgentDefinition } from '@collegium/config';
import { Result } from '@collegium/core/utils';
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
import { InferenceRegistry } from '@/inference/inference.registry.ts';
import { LoggingService } from '@/logging/logging.service.ts';
import { MailBootService } from '@/mail/boot/boot.service.ts';
import { MailInboundService } from '@/mail/inbound/inbound.service.ts';
import { NotificationsService } from '@/notifications/notifications.service.ts';
import { SchedulesService } from '@/schedules/schedules.service.ts';
import { ShellService } from '@/shell/shell.service.ts';
import { SkillsService } from '@/skills/skills.service.ts';
import { StallsService } from '@/stalls/stalls.service.ts';
import { createConfigServiceMock } from '@/testing/factories/config-service.factory.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';
import { createObservedPost } from '@/testing/factories/observed-post.factory.ts';
import { ToolRegistry } from '@/tools/tools.registry.ts';
import { TriggersService } from '@/triggers/triggers.service.ts';

import { BootService } from '../boot/boot.service.ts';
import { RuntimeService } from '../runtime.service.ts';

const DEFINITION: AgentDefinition = {
  contextBudgetTokens: 8000,
  displayName: 'Mira',
  expertise: 'testing',
  model: { name: 'deepseek-v4-flash', provider: 'deepseek' },
  personality: undefined,
  schedules: {},
  skills: [],
  systemPrompt: 'You are Mira.',
  tools: [],
  toolSettings: {},
  turnContextCeilingTokens: 200_000,
  username: 'mira'
};

const MEMBERSHIP_EVENT: ChatEvent.Membership = {
  agentUsername: 'mira',
  channelId: 'channel-1',
  kind: 'user_added_to_channel',
  username: 'mira'
};

describe('RuntimeService', () => {
  let activationService: MockedInstance<ActivationService>;
  let agentRegistry: MockedInstance<AgentRegistry>;
  let bootService: MockedInstance<BootService>;
  let chatGateway: MockedInstance<ChatGateway>;
  let commandReconcilerService: MockedInstance<CommandReconcilerService>;
  let credentialsService: MockedInstance<CredentialsService>;
  let haltService: MockedInstance<HaltService>;
  let inferenceRegistry: MockedInstance<InferenceRegistry>;
  let notificationsService: MockedInstance<NotificationsService>;
  let resyncService: MockedInstance<ResyncService>;
  let rosterService: MockedInstance<RosterService>;
  let schedulesService: MockedInstance<SchedulesService>;
  let shellService: MockedInstance<ShellService>;
  let skillsService: MockedInstance<SkillsService>;
  let toolRegistry: MockedInstance<ToolRegistry>;
  let transport: MockedInstance<ChatTransport>;
  let transportRegistry: MockedInstance<TransportRegistry>;
  let triggersService: MockedInstance<TriggersService>;
  let handleEvent: ChatEventHandler;
  let mira: AgentProfile;
  let workspaceRoot: string;

  const compile = (overrides: PartialDeep<$Config> = {}): Promise<RuntimeService> => {
    return Test.createTestingModule({
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
        { provide: InferenceRegistry, useValue: inferenceRegistry },
        MockFactory.createForService(LoggingService),
        MockFactory.createForService(MailBootService),
        MockFactory.createForService(MailInboundService),
        { provide: NotificationsService, useValue: notificationsService },
        { provide: ResyncService, useValue: resyncService },
        { provide: RosterService, useValue: rosterService },
        { provide: SchedulesService, useValue: schedulesService },
        { provide: ShellService, useValue: shellService },
        { provide: SkillsService, useValue: skillsService },
        MockFactory.createForService(StallsService),
        { provide: ToolRegistry, useValue: toolRegistry },
        { provide: TransportRegistry, useValue: transportRegistry },
        { provide: TriggersService, useValue: triggersService }
      ]
    })
      .compile()
      .then((moduleRef) => moduleRef.get(RuntimeService));
  };

  beforeEach(() => {
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'collegium-runtime-'));
    mira = {
      actionBudget: 25,
      contextBudgetTokens: 1000,
      displayName: 'Mira',
      expertise: 'testing',
      model: { name: 'deepseek-v4-flash', provider: 'deepseek' },
      personality: undefined,
      skills: [],
      systemPrompt: 'You are Mira.',
      tools: [],
      toolSettings: new Map(),
      turnContextCeilingTokens: 27_200,
      username: 'mira',
      workspaceDir: path.join(workspaceRoot, 'mira')
    };
    activationService = MockFactory.createMock(ActivationService);
    agentRegistry = MockFactory.createMock(AgentRegistry);
    agentRegistry.list.mockReturnValue([mira]);
    agentRegistry.get.mockReturnValue(mira);
    bootService = MockFactory.createMock(BootService);
    bootService.run.mockResolvedValue({
      abandonedTurns: 2,
      downtime: { kind: 'clean', startedAt: new Date(2000), stoppedAt: new Date(1000) },
      requeuedTurns: 1,
      strandedUnits: []
    });
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
    inferenceRegistry = MockFactory.createMock(InferenceRegistry);
    inferenceRegistry.assertCredentialsVerified.mockResolvedValue(undefined);
    notificationsService = MockFactory.createMock(NotificationsService);
    resyncService = MockFactory.createMock(ResyncService);
    resyncService.recover.mockResolvedValue([]);
    rosterService = MockFactory.createMock(RosterService);
    schedulesService = MockFactory.createMock(SchedulesService);
    schedulesService.reconcile.mockResolvedValue(undefined);
    shellService = MockFactory.createMock(ShellService);
    shellService.assertProvisioned.mockResolvedValue(undefined);
    skillsService = MockFactory.createMock(SkillsService);
    toolRegistry = MockFactory.createMock(ToolRegistry);
    toolRegistry.listFor.mockReturnValue([{ gates: false, id: ['memory', 'write'] }]);
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

  it('should verify every agent’s provider credentials before any capability is provisioned (§7.3)', async () => {
    const runtimeService = await compile();
    inferenceRegistry.assertCredentialsVerified.mockImplementation(() => {
      expect(shellService.assertProvisioned).not.toHaveBeenCalled();
      expect(chatGateway.connect).not.toHaveBeenCalled();
      return Promise.resolve();
    });
    await runtimeService.onApplicationBootstrap();
    expect(inferenceRegistry.assertCredentialsVerified).toHaveBeenCalledExactlyOnceWith([DEFINITION]);
  });

  it('should refuse to boot, leaving every transport unconnected, when a provider rejects a key (§7.3)', async () => {
    inferenceRegistry.assertCredentialsVerified.mockRejectedValue(new Error('provider credential verification failed'));
    const runtimeService = await compile();
    await expect(runtimeService.onApplicationBootstrap()).rejects.toThrow('provider credential verification failed');
    expect(chatGateway.connect).not.toHaveBeenCalled();
    expect(bootService.run).not.toHaveBeenCalled();
  });

  it('should verify each granted skill’s tools against what its agent holds, before any turn can run (§3.5)', async () => {
    const runtimeService = await compile();
    skillsService.assertGrantedToolsCoverSkills.mockImplementation(() => {
      expect(chatGateway.connect).not.toHaveBeenCalled();
    });
    await runtimeService.onApplicationBootstrap();
    expect(skillsService.assertGrantedToolsCoverSkills).toHaveBeenCalledExactlyOnceWith(
      new Map([['mira', [['memory', 'write']]]])
    );
  });

  it('should reconcile and start the schedule ticker once the roster has (§4.2)', async () => {
    const runtimeService = await compile();
    schedulesService.reconcile.mockImplementation(() => {
      expect(bootService.run).toHaveBeenCalled();
      return Promise.resolve();
    });
    await runtimeService.onApplicationBootstrap();
    expect(schedulesService.reconcile).toHaveBeenCalledOnce();
    expect(schedulesService.start).toHaveBeenCalledOnce();
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
      downtime: { kind: 'clean', startedAt: new Date(2000), stoppedAt: new Date(1000) },
      kind: 'online',
      requeuedTurns: 1,
      strandedUnits: []
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
      new Promise(
        (resolve) => (finishBoot = () => resolve({ abandonedTurns: 0, downtime: undefined, requeuedTurns: 0, strandedUnits: [] }))
      )
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
    rosterService.onMembershipEvent.mockResolvedValue(Result.ok(undefined));
    const runtimeService = await compile();
    await runtimeService.onApplicationBootstrap();
    await handleEvent(MEMBERSHIP_EVENT);
    expect(rosterService.onMembershipEvent).toHaveBeenCalledExactlyOnceWith(MEMBERSHIP_EVENT);
    expect(haltService.halt).not.toHaveBeenCalled();
    expect(activationService.onPost).not.toHaveBeenCalled();
  });

  it('should halt when a membership event breaks the one-agent rule (§3.10)', async () => {
    rosterService.onMembershipEvent.mockResolvedValue(
      Result.ok({
        agentUsernames: ['mira', 'robin'],
        channelId: 'channel-1'
      })
    );
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
