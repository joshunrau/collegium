import { Injectable } from '@nestjs/common';

import { EXTEND_BUDGET_ACTION } from '@/approvals/approvals.constants.ts';
import { PendingDecisionsService } from '@/approvals/decisions/pending-decisions.service.ts';
import { ChannelLockService } from '@/channels/locks/channel-lock.service.ts';
import { ConversationsService } from '@/conversations/conversations.service.ts';
import { DateFormatter } from '@/formatting/dates/date.formatter.ts';
import { QueueService } from '@/queue/queue.service.ts';
import { TurnsService } from '@/turns/turns.service.ts';

import type { LaneHold, LaneParkedOn, LaneReport, QueueBacklog } from '../handlers/queue.utils.ts';

/** §8.4 — one agent's lane in a channel, as /collegium queue reports it: the turn holding it, and what waits behind it */
@Injectable()
export class LaneReportService {
  constructor(
    private readonly channelLockService: ChannelLockService,
    private readonly conversationsService: ConversationsService,
    private readonly dateFormatter: DateFormatter,
    private readonly pendingDecisionsService: PendingDecisionsService,
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

  /** §5.2 — the posts waiting in the lane, which a running turn has not taken: the depth is a count of posts */
  private async readBacklog(agentUsername: string, channelId: string): Promise<QueueBacklog | undefined> {
    const standing = await this.queueService.listUntaken({ agentUsername, channelId });
    const [oldest] = standing;
    if (oldest === undefined) {
      return undefined;
    }
    return {
      depth: standing.length,
      oldest: {
        message: (await this.conversationsService.findUnforgotten(oldest.postId))?.message,
        postId: oldest.postId
      }
    };
  }

  private async readHold(agentUsername: string, channelId: string): Promise<LaneHold | undefined> {
    const heldSince = this.channelLockService.heldSince(agentUsername, channelId);
    if (heldSince === undefined) {
      return undefined;
    }
    const turn = await this.turnsService.findRunningIn(agentUsername, channelId);
    return {
      heldForMs: Date.now() - heldSince.getTime(),
      heldSince: this.dateFormatter.format(heldSince),
      parkedOn: turn === undefined ? undefined : await this.readParkedOn(turn.id),
      turn
    };
  }

  /** §8.1 — the earliest decision the turn waits on, as its status post names it: a turn parked on a person is not running */
  private async readParkedOn(turnId: string): Promise<LaneParkedOn | undefined> {
    const [earliest] = (await this.pendingDecisionsService.listPending({ turnId })).toSorted(
      (left, right) => left.requestedAt.getTime() - right.requestedAt.getTime()
    );
    if (earliest === undefined) {
      return undefined;
    }
    const on =
      earliest.kind === 'ask' ? 'question' : earliest.actionName === EXTEND_BUDGET_ACTION ? 'attempts' : 'approval';
    return { on, since: this.dateFormatter.format(earliest.requestedAt) };
  }
}
