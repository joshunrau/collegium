import { Result } from '@collegium/core/utils';
import { Injectable } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';

import { DateFormatter } from '@/formatting/dates/date.formatter.ts';
import { LoggingService } from '@/logging/logging.service.ts';
import { InjectModel } from '@/prisma/prisma.decorators.ts';
import type { Model } from '@/prisma/prisma.types.ts';
import { TriggersService } from '@/triggers/triggers.service.ts';
import type { Trigger } from '@/triggers/triggers.types.ts';

import { MailRegistry } from '../mail.registry.ts';
import { renderMailAnnouncement } from '../mail.utils.ts';
import { MailOutageService } from '../outage/outage.service.ts';
import { INBOUND_PAGE_SIZE } from './inbound.constants.ts';

import type { MailboxRuntime } from '../mail.registry.ts';
import type { MailArrival } from '../mail.types.ts';

/**
 * §4.2's mail adapter: deterministic code that reads a mailbox and records a trigger row per
 * arrival. It never posts and never starts a turn — announcing is the system bot's, gated on the
 * channel being idle.
 *
 * The ordering is the guarantee (§4.5): every arrival is recorded durably *before* the cursor
 * advances, so a crash in between re-reads the same page and the dedupe key absorbs the repeat.
 * Nothing is ever skipped; at worst something is seen twice and recorded once.
 */
@Injectable()
export class MailInboundService implements OnApplicationShutdown {
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly dateFormatter: DateFormatter,
    private readonly loggingService: LoggingService,
    private readonly mailOutageService: MailOutageService,
    private readonly mailRegistry: MailRegistry,
    private readonly triggersService: TriggersService,
    @InjectModel('MailCursor') private readonly cursors: Model<'MailCursor'>
  ) {}

  /** the §4.6 hook: a mark-read failure leaves the trigger outstanding rather than looking handled */
  async markHandled(trigger: Trigger): Promise<Result<void, { message: string }>> {
    const provider = this.mailRegistry.providerFor(trigger.targetAgentUsername);
    const ref = trigger.reference.id;
    if (!provider || ref === undefined) {
      return Result.err({ message: 'the announcement names no message this agent can mark read' });
    }
    const marked = await provider.markRead(ref);
    if (!marked.success) {
      return Result.err({ message: `the message could not be marked read: ${marked.error.kind}` });
    }
    return Result.ok();
  }

  onApplicationShutdown(): void {
    for (const timer of this.timers.values()) {
      clearInterval(timer);
    }
    this.timers.clear();
  }

  /** exposed for the boot sweep and tests; a poll never throws, so a bad round cannot kill the timer */
  async pollOnce(mailbox: MailboxRuntime): Promise<void> {
    try {
      await this.poll(mailbox);
    } catch (error) {
      await this.mailOutageService.recordFailedRead(
        mailbox,
        error instanceof Error ? error.message : 'the poll failed'
      );
    }
  }

  /**
   * One repeating poll per configured mailbox, plus the §4.6 hook: resolving a mail trigger marks
   * the message read, so the same item is not worked twice by a human and an agent. Called once,
   * after boot has proven every mailbox.
   */
  start(): void {
    this.triggersService.onResolving('mail', (trigger) => this.markHandled(trigger));
    for (const mailbox of this.mailRegistry.list()) {
      const timer = setInterval(() => void this.pollOnce(mailbox), mailbox.pollIntervalMs);
      timer.unref();
      this.timers.set(mailbox.agentUsername, timer);
    }
  }

  private async announce(mailbox: MailboxRuntime, arrival: MailArrival): Promise<void> {
    const recorded = await this.triggersService.record({
      dedupeKey: `mail:${mailbox.agentUsername}:${arrival.ref}`,
      reference: {
        body: renderMailAnnouncement(arrival, this.dateFormatter.format(arrival.receivedAt)),
        id: arrival.ref,
        sender: arrival.sender.address,
        subject: arrival.subject
      },
      source: 'mail',
      targetAgentUsername: mailbox.agentUsername,
      targetChannelId: mailbox.announcementChannelId
    });
    if (!recorded.success) {
      // intake refusals are configuration facts boot already checked; a live one must be loud
      throw new Error(`the arrival could not be recorded: ${JSON.stringify(recorded.error)}`);
    }
  }

  /** §4.4 — the mailbox as it stands is old mail; only what arrives afterwards is new */
  private async initialize(mailbox: MailboxRuntime): Promise<void> {
    const initialized = await mailbox.provider.initializeCursor();
    if (!initialized.success) {
      await this.mailOutageService.recordFailedRead(mailbox, initialized.error.message);
      return;
    }
    await this.writeCursor(mailbox.agentUsername, initialized.value);
    await this.mailOutageService.recordSuccessfulRead(mailbox);
  }

  private async poll(mailbox: MailboxRuntime): Promise<void> {
    const stored = await this.cursors.findUnique({ where: { agentUsername: mailbox.agentUsername } });
    if (!stored) {
      await this.initialize(mailbox);
      return;
    }
    const polled = await mailbox.provider.pollNew(stored.cursor, INBOUND_PAGE_SIZE);
    if (!polled.success) {
      if (polled.error.kind === 'cursor-reset') {
        this.loggingService.warn(
          `the mail cursor for ${mailbox.provider.address} was invalidated (${polled.error.message}); re-initializing without announcing`
        );
        await this.initialize(mailbox);
        return;
      }
      await this.mailOutageService.recordFailedRead(mailbox, polled.error.message);
      return;
    }
    for (const arrival of polled.value.messages) {
      await this.announce(mailbox, arrival);
    }
    await this.writeCursor(mailbox.agentUsername, polled.value.cursor);
    await this.mailOutageService.recordSuccessfulRead(mailbox);
  }

  private async writeCursor(agentUsername: string, cursor: string): Promise<void> {
    await this.cursors.upsert({
      create: { agentUsername, cursor },
      update: { cursor },
      where: { agentUsername }
    });
  }
}
