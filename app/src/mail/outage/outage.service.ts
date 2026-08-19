import { Injectable } from '@nestjs/common';

import { ChatGateway } from '@/chat/chat.gateway.ts';
import { LoggingService } from '@/logging/logging.service.ts';

import { OUTAGE_NOTICE_THRESHOLD } from './outage.constants.ts';

import type { MailboxRuntime } from '../mail.registry.ts';

/** one unreadable mailbox, from the first failed read to the one that succeeds */
type OutageEpisode = {
  consecutiveFailures: number;
  isAnnounced: boolean;
};

/**
 * A mailbox that cannot be read is an episode, not an event: the announcement channel hears once
 * that it is down and once that it is back, however many reads failed in between. Boot announces on
 * the first failure because a human is watching the launch and nothing has polled yet; polling waits
 * for the failure to repeat, so a blip between two polls stays quiet.
 */
@Injectable()
export class MailOutageService {
  private readonly episodes = new Map<string, OutageEpisode>();

  constructor(
    private readonly chatGateway: ChatGateway,
    private readonly loggingService: LoggingService
  ) {}

  /** boot's path — a mailbox unreachable at launch is news immediately, not three polls later */
  async announceUnreachable(mailbox: MailboxRuntime, message: string): Promise<void> {
    await this.recordFailure(mailbox, message, 1);
  }

  /** polling's path — reads are safe to repeat, so polling continues and the channel hears once */
  async recordFailedRead(mailbox: MailboxRuntime, message: string): Promise<void> {
    await this.recordFailure(mailbox, message, OUTAGE_NOTICE_THRESHOLD);
  }

  /** ends the episode, posting the all-clear only if the channel was told about it */
  async recordSuccessfulRead(mailbox: MailboxRuntime): Promise<void> {
    const episode = this.episodes.get(mailbox.agentUsername);
    this.episodes.delete(mailbox.agentUsername);
    if (episode?.isAnnounced) {
      await this.post(
        mailbox,
        `📬 @${mailbox.agentUsername} — the mailbox ${mailbox.provider.address} can be read again; arriving mail will be announced.`
      );
    }
  }

  private async post(mailbox: MailboxRuntime, content: string): Promise<boolean> {
    const posted = await this.chatGateway.postAsSystemIn(mailbox.announcementChannelId, content);
    if (!posted.success) {
      this.loggingService.error(
        new Error(`the notice for ${mailbox.provider.address} could not be posted: ${posted.error.message}`)
      );
    }
    return posted.success;
  }

  private async recordFailure(mailbox: MailboxRuntime, message: string, noticeThreshold: number): Promise<void> {
    this.loggingService.error(new Error(`reading the mailbox ${mailbox.provider.address} failed: ${message}`));
    const episode = this.episodes.get(mailbox.agentUsername) ?? { consecutiveFailures: 0, isAnnounced: false };
    episode.consecutiveFailures += 1;
    this.episodes.set(mailbox.agentUsername, episode);
    if (episode.isAnnounced || episode.consecutiveFailures < noticeThreshold) {
      return;
    }
    // the flag says the channel was told, so a refused post leaves the notice owed to the next failure
    episode.isAnnounced = await this.post(
      mailbox,
      `📪 @${mailbox.agentUsername} — the mailbox ${mailbox.provider.address} cannot be read: ${message}. Polling continues; arriving mail will be announced once it recovers.`
    );
  }
}
