import { Injectable } from '@nestjs/common';

import { RosterService } from '@/channels/roster/roster.service.ts';
import { TransportRegistry } from '@/chat/transports/transport.registry.ts';

import { MailRegistry } from '../mail.registry.ts';
import { MailOutageService } from '../outage/outage.service.ts';

import type { MailboxRuntime } from '../mail.registry.ts';

/**
 * Every mailbox is proven usable before the system runs. What configuration got wrong — an
 * announcement channel that is a DM or that the agent is not in, credentials the provider refuses —
 * is a boot refusal that names it, never a runtime surprise. A mailbox that is merely unreachable is
 * not that: waiting fixes a network, so the announcement channel is told and the framework runs,
 * exactly as it would for the same outage a minute after boot.
 */
@Injectable()
export class MailBootService {
  constructor(
    private readonly mailOutageService: MailOutageService,
    private readonly mailRegistry: MailRegistry,
    private readonly rosterService: RosterService,
    private readonly transportRegistry: TransportRegistry
  ) {}

  /** call after transports are connected and the roster is reconciled — both checks read them */
  async assertReadyAndAnnounceOutages(): Promise<void> {
    for (const mailbox of this.mailRegistry.list()) {
      await this.assertMailboxReadyAndAnnounceOutage(mailbox);
    }
  }

  private async assertMailboxReadyAndAnnounceOutage(mailbox: MailboxRuntime): Promise<void> {
    const where = `agent "${mailbox.agentUsername}" mailbox ${mailbox.provider.address}`;
    const isDirect = await this.transportRegistry
      .get(mailbox.agentUsername)
      .isDirectMessageChannel(mailbox.announcementChannelId);
    if (!isDirect.success) {
      throw new Error(`${where}: the announcement channel could not be checked: ${isDirect.error.message}`);
    }
    if (isDirect.value) {
      throw new Error(`${where}: the announcement channel is a direct message, and announcements belong in a channel`);
    }
    if (!this.rosterService.isAgentIn(mailbox.agentUsername, mailbox.announcementChannelId)) {
      throw new Error(`${where}: the agent is not a member of the announcement channel`);
    }
    const probed = await mailbox.provider.probe();
    if (probed.success) {
      return;
    }
    if (probed.error.kind === 'auth') {
      throw new Error(`${where}: the mailbox credentials were refused: ${probed.error.message}`);
    }
    await this.mailOutageService.announceUnreachable(mailbox, probed.error.message);
  }
}
