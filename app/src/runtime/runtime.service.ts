import * as fs from 'node:fs/promises';

import type { $AgentDefinition } from '@collegium/config';
import { Injectable } from '@nestjs/common';
import type { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';

import { ActivationService } from '@/activation/activation.service.ts';
import { AgentRegistry } from '@/agents/agents.registry.ts';
import { RosterService } from '@/channels/roster/roster.service.ts';
import { ChatGateway } from '@/chat/chat.gateway.ts';
import type { ChatEvent } from '@/chat/chat.types.ts';
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
import type { SystemEvent } from '@/notifications/notifications.types.ts';
import { ShellService } from '@/shell/shell.service.ts';
import { TriggersService } from '@/triggers/triggers.service.ts';

import { BootService } from './boot/boot.service.ts';

import type { RunningAgent } from './runtime.types.ts';

@Injectable()
export class RuntimeService implements OnApplicationBootstrap, OnApplicationShutdown {
  /** §7.3 — what arrived while boot was still running, replayed in order once it has finished */
  private readonly bufferedEvents: { event: ChatEvent; running: RunningAgent }[] = [];
  private isBooted = false;
  private running = new Map<string, RunningAgent>();

  constructor(
    private readonly activationService: ActivationService,
    private readonly agentRegistry: AgentRegistry,
    private readonly bootService: BootService,
    private readonly chatGateway: ChatGateway,
    private readonly commandReconcilerService: CommandReconcilerService,
    private readonly configService: ConfigService,
    private readonly credentialsService: CredentialsService,
    private readonly haltService: HaltService,
    private readonly loggingService: LoggingService,
    private readonly mailBootService: MailBootService,
    private readonly mailInboundService: MailInboundService,
    private readonly notificationsService: NotificationsService,
    private readonly resyncService: ResyncService,
    private readonly rosterService: RosterService,
    private readonly shellService: ShellService,
    private readonly transportRegistry: TransportRegistry,
    private readonly triggersService: TriggersService
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // §8.4 runs before any transport connects, so /stop is registered before any turn can start.
    // A residual window remains: the HTTP port binds only after bootstrap, so a command clicked
    // during boot is registered but undeliverable until listen() — same as every other endpoint.
    await this.commandReconcilerService.reconcile();
    // §6.1 — fail loudly here if a shell-holding agent's dedicated OS user is not provisioned, before any turn can run
    await this.shellService.assertProvisioned(this.agentRegistry.list());
    await Promise.all(
      this.agentRegistry.list().map((profile) => fs.mkdir(profile.workspaceDir, { mode: 0o700, recursive: true }))
    );
    const started = await Promise.all(this.configService.get('agents').map((definition) => this.start(definition)));
    this.running = new Map(started.map((running) => [running.profile.username, running]));
    this.triggersService.onRecorded((channelId) => void this.activationService.flushTriggersIfIdle(channelId));
    const boot = await this.bootService.run();
    await this.drainBufferedEvents();
    // after boot: the DM check needs connected transports and the membership check a reconciled roster
    await this.mailBootService.assertReadyAndAnnounceOutages();
    this.mailInboundService.start();
    this.loggingService.log(`connected ${this.running.size} agent(s), listening for messages`);
    if (this.configService.get('app.enableLifecycleNotifications')) {
      await this.notificationsService.notify({
        abandonedTurns: boot.abandonedTurns,
        agentUsernames: Array.from(this.running.keys()),
        downSince: boot.downSince,
        kind: 'online'
      } satisfies SystemEvent.Online);
    }
  }

  onApplicationShutdown(): void {
    for (const { transport } of this.running.values()) {
      transport.disconnect();
    }
  }

  /**
   * The sockets are live from the moment each agent connects, but nothing acts on what they carry
   * until the §7.3 sweep has finished. Acting earlier means acting on a stale world: the roster is
   * empty until it reconciles, so the §4.5 multi-mention refusal answers false for a post naming two
   * present agents and both start turns — and a turn started before the sweep is abandoned by it, or
   * has its approval invalidated out from under it. Buffering rather than reordering the connect is
   * what keeps that from costing anything: no post goes unobserved while boot completes.
   */
  private async drainBufferedEvents(): Promise<void> {
    const buffered = this.bufferedEvents.splice(0, this.bufferedEvents.length);
    this.isBooted = true;
    for (const { event, running } of buffered) {
      await this.handleEvent(running, event);
    }
  }

  private async handleEvent(running: RunningAgent, event: ChatEvent): Promise<void> {
    if (!this.isBooted) {
      this.bufferedEvents.push({ event, running });
      return;
    }
    if (event.kind === 'posted') {
      await this.activationService.onPost(running.profile, event.post);
      return;
    }
    if (event.kind === 'resync') {
      // §5.2 — the socket dropped events, so what it missed is re-read and queued rather than lost
      await this.activationService.onResynced(running.profile, await this.resyncService.recover(running.profile));
      return;
    }
    const violation = this.rosterService.onMembershipEvent(event);
    if (violation) {
      // boot refuses to start on this topology; a running process cannot refuse, so it stops (§3.10)
      await this.haltService.halt({ ...violation, kind: 'topology-violation' });
    }
  }

  private async start(definition: $AgentDefinition): Promise<RunningAgent> {
    const profile = this.agentRegistry.get(definition.username);
    if (!profile) {
      throw new Error(`no profile registered for agent "${definition.username}"`);
    }
    const botToken = await this.credentialsService.require(definition.username);
    const transport = await this.chatGateway.connect({ agent: profile, botToken });
    this.transportRegistry.register(profile.username, transport);
    const running: RunningAgent = { profile, transport };
    transport.listen((event) => this.handleEvent(running, event));
    return running;
  }
}
