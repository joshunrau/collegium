import { Injectable } from '@nestjs/common';

import { RosterService } from '@/channels/roster/roster.service.ts';
import { TransportRegistry } from '@/chat/transports/transport.registry.ts';

import { MailRegistry } from '../mail.registry.ts';

import type { MailboxRuntime } from '../mail.registry.ts';

/**
 * Every mailbox is proven usable before the system runs: the announcement channel is not a DM and
 * holds the agent, and the provider's credentials reach the one mailbox they claim. A failure here
 * is a boot refusal that names what is wrong, never a runtime surprise.
 */
@Injectable()
export class MailBootService {
  constructor(
    private readonly mailRegistry: MailRegistry,
    private readonly rosterService: RosterService,
    private readonly transportRegistry: TransportRegistry
  ) {}

  /** call after transports are connected and the roster is reconciled — both checks read them */
  async assertReady(): Promise<void> {
    for (const mailbox of this.mailRegistry.list()) {
      await this.assertMailboxReady(mailbox);
    }
  }

  private async assertMailboxReady(mailbox: MailboxRuntime): Promise<void> {
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
    if (!probed.success) {
      throw new Error(`${where}: the mailbox probe failed (${probed.error.kind}): ${probed.error.message}`);
    }
  }
}
