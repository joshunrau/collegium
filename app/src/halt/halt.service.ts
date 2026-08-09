import { Result } from '@collegium/core/utils';
import { Injectable } from '@nestjs/common';

import { ApprovalsService } from '@/approvals/approvals.service.ts';
import { RosterService } from '@/channels/roster/roster.service.ts';
import { ConfigService } from '@/config/config.service.ts';
import { LoggingService } from '@/logging/logging.service.ts';
import { NotificationsService } from '@/notifications/notifications.service.ts';

import type { HaltFailure, HaltReason } from './halt.types.ts';

const ROLLING_HOUR_MS = 60 * 60 * 1000;

/**
 * The §7.4 circuit breaker: a framework-wide ceiling on turns per rolling hour, and the stop for a
 * structural invariant broken at runtime (§3.10). Everything here is in memory on purpose — a halt
 * does not survive a restart, because a restart abandons every in-flight turn and therefore breaks
 * whatever loop tripped it.
 */
@Injectable()
export class HaltService {
  private readonly ceiling: number;
  private haltedFor: HaltReason | undefined;
  private turnStartTimes: number[] = [];

  constructor(
    private readonly approvalsService: ApprovalsService,
    configService: ConfigService,
    private readonly loggingService: LoggingService,
    private readonly notificationsService: NotificationsService,
    private readonly rosterService: RosterService
  ) {
    this.ceiling = configService.get('app.turnCeilingPerHour');
  }

  /**
   * Counts a turn against the rolling hour; the turn past the ceiling is refused and raises the
   * halt. Refused is the point — that turn is the one a runaway loop generates.
   */
  async admitTurnStart(): Promise<boolean> {
    if (this.haltedFor) {
      return false;
    }
    const now = Date.now();
    this.turnStartTimes = this.turnStartTimes.filter((startedAt) => now - startedAt < ROLLING_HOUR_MS);
    if (this.turnStartTimes.length >= this.ceiling) {
      await this.halt({ ceiling: this.ceiling, kind: 'turn-ceiling' });
      return false;
    }
    this.turnStartTimes.push(now);
    return true;
  }

  /** halting twice tells the humans nothing new: the first reason stands until a /resume clears it */
  async halt(reason: HaltReason): Promise<void> {
    if (this.haltedFor) {
      return;
    }
    this.haltedFor = reason;
    this.loggingService.warn(`global halt raised: ${reason.kind}`);
    await this.notificationsService.notify({ kind: 'halt', reason });
    await this.approvalsService.invalidateAll('halt');
  }

  isHalted(): boolean {
    return this.haltedFor !== undefined;
  }

  /**
   * Refuses while the condition that raised the halt still holds — clearing over a standing §3.10
   * violation would return the system to the exact state that tripped it (§8.4).
   */
  resume(byUsername: string): Result<void, HaltFailure> {
    if (!this.haltedFor) {
      return Result.err({ kind: 'not-halted' });
    }
    const violation = this.rosterService.findRespondToAllViolation();
    if (violation) {
      return Result.err({ channelId: violation.channelId, kind: 'violation-standing' });
    }
    this.loggingService.warn(`global halt cleared by ${byUsername}`);
    this.haltedFor = undefined;
    this.turnStartTimes = [];
    return Result.ok();
  }
}
