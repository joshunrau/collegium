import type { $StallThresholds } from '@collegium/config';
import { Injectable } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';

import { PendingDecisionsService } from '@/approvals/decisions/pending-decisions.service.ts';
import { ChannelLockService } from '@/channels/locks/channel-lock.service.ts';
import { ConfigService } from '@/config/config.service.ts';
import { HaltService } from '@/halt/halt.service.ts';
import { LoggingService } from '@/logging/logging.service.ts';
import { NotificationsService } from '@/notifications/notifications.service.ts';
import { QueueService } from '@/queue/queue.service.ts';

import { STALL_SWEEP_MS } from './stalls.constants.ts';

/** one stall as consecutive sweeps see it: when its clock started, and whether it has been said */
type Episode = {
  announced: boolean;
  readonly clockStartedAt: Date;
};

/**
 * §7.6 — announces a standing queue and a long turn, once per episode, and never clears either.
 *
 * Each sweep carries forward the episodes it still observes and drops the rest, which is what
 * re-arms one: a standing queue is keyed by its entry, so work queued after a drain or discard is a
 * new episode, and a long turn by the lock it holds, so the next turn starts its own. The standing
 * clock starts at the first sweep to find the entry with no turn running, never at the entry's
 * creation: an entry queued behind a long turn has stood only since that turn ended.
 */
@Injectable()
export class StallsService implements OnApplicationShutdown {
  private longTurns = new Map<string, Episode>();
  private standingQueues = new Map<string, Episode>();
  private readonly thresholds: $StallThresholds;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly channelLockService: ChannelLockService,
    configService: ConfigService,
    private readonly haltService: HaltService,
    private readonly loggingService: LoggingService,
    private readonly notificationsService: NotificationsService,
    private readonly pendingDecisionsService: PendingDecisionsService,
    private readonly queueService: QueueService
  ) {
    this.thresholds = configService.get('notifications.stalls');
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  start(): void {
    this.timer = setInterval(() => void this.sweep(new Date()), STALL_SWEEP_MS);
    this.timer.unref();
  }

  /** exposed for tests; a sweep never throws, so one failed read cannot kill the timer */
  async sweep(now: Date): Promise<void> {
    if (this.haltService.isHalted()) {
      return;
    }
    try {
      await this.sweepLongTurns(now);
      await this.sweepStandingQueues(now);
    } catch (error) {
      this.loggingService.error(new Error('the stall sweep failed', { cause: error }));
    }
  }

  private isDue(episode: Episode, thresholdMs: number, now: Date): boolean {
    return !episode.announced && now.getTime() - episode.clockStartedAt.getTime() >= thresholdMs;
  }

  private async sweepLongTurns(now: Date): Promise<void> {
    const observed = new Map<string, Episode>();
    for (const { acquiredAt, agentUsername, channelId } of this.channelLockService.listHeld()) {
      const key = `${agentUsername}:${channelId}:${acquiredAt.getTime()}`;
      if (await this.pendingDecisionsService.isWaitingOnPerson(agentUsername, channelId)) {
        observed.set(key, { announced: false, clockStartedAt: now });
        continue;
      }
      const episode = this.longTurns.get(key) ?? { announced: false, clockStartedAt: acquiredAt };
      observed.set(key, episode);
      if (this.isDue(episode, this.thresholds.longTurnMs, now)) {
        episode.announced = true;
        const heldMs = now.getTime() - episode.clockStartedAt.getTime();
        await this.notificationsService.notify({ agentUsername, channelId, heldMs, kind: 'long-turn' });
      }
    }
    this.longTurns = observed;
  }

  private async sweepStandingQueues(now: Date): Promise<void> {
    const observed = new Map<string, Episode>();
    for (const { agentUsername, channelId, id } of await this.queueService.listAll()) {
      if (this.channelLockService.isBusy(agentUsername, channelId)) {
        continue;
      }
      const episode = this.standingQueues.get(id) ?? { announced: false, clockStartedAt: now };
      observed.set(id, episode);
      if (this.isDue(episode, this.thresholds.standingQueueMs, now)) {
        episode.announced = true;
        await this.notificationsService.notify({ agentUsername, channelId, kind: 'standing-queue' });
      }
    }
    this.standingQueues = observed;
  }
}
