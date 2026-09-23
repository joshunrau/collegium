import { Injectable } from '@nestjs/common';

import { ChannelLockService } from '@/channels/locks/channel-lock.service.ts';
import { ConversationsService } from '@/conversations/conversations.service.ts';
import { DateFormatter } from '@/formatting/dates/date.formatter.ts';
import { QueueService } from '@/queue/queue.service.ts';
import { TurnsService } from '@/turns/turns.service.ts';

import type { LaneHold, LaneReport, QueueBacklog } from '../handlers/queue.utils.ts';

/** §8.4 — one agent's lane in a channel, as /collegium queue reports it: the turn holding it, and what waits behind it */
@Injectable()
export class LaneReportService {
  constructor(
    private readonly channelLockService: ChannelLockService,
    private readonly conversationsService: ConversationsService,
    private readonly dateFormatter: DateFormatter,
    private readonly queueService: QueueService,
    private readonly turnsService: TurnsService
  ) {}

  async read(agentUsername: string, channelId: string): Promise<LaneReport> {
    const [hold, backlog] = await Promise.all([
      this.readHold(agentUsername, channelId),
      this.readBacklog(agentUsername, channelId)
    ]);
    return { backlog, hold };
  }

  private async readBacklog(agentUsername: string, channelId: string): Promise<QueueBacklog | undefined> {
    const entry = await this.queueService.peek(agentUsername, channelId);
    if (!entry) {
      return undefined;
    }
    const { earliestUnprocessedPostId } = entry;
    return {
      earliestUnprocessedPostId,
      summary: await this.conversationsService.summarizeBacklog(channelId, earliestUnprocessedPostId)
    };
  }

  private async readHold(agentUsername: string, channelId: string): Promise<LaneHold | undefined> {
    const heldSince = this.channelLockService.heldSince(agentUsername, channelId);
    if (heldSince === undefined) {
      return undefined;
    }
    return {
      heldForMs: Date.now() - heldSince.getTime(),
      heldSince: this.dateFormatter.format(heldSince),
      turn: await this.turnsService.findRunningIn(agentUsername, channelId)
    };
  }
}
