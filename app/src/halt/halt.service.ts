import { Result } from '@collegium/core/utils';
import { Injectable } from '@nestjs/common';

import { ApprovalsService } from '@/approvals/approvals.service.ts';
import { RosterService } from '@/channels/roster/roster.service.ts';
import { ConfigService } from '@/config/config.service.ts';
import { LoggingService } from '@/logging/logging.service.ts';
import { NotificationsService } from '@/notifications/notifications.service.ts';
import { InjectModel } from '@/prisma/prisma.decorators.ts';
import type { Model } from '@/prisma/prisma.types.ts';
import { TurnsService } from '@/turns/turns.service.ts';

import type { HaltFailure, HaltReason } from './halt.types.ts';

const ROLLING_HOUR_MS = 60 * 60 * 1000;

/** the watermark is one row; the key names it rather than a magic uuid nobody could look up */
const WATERMARK_KEY = 'turn-ceiling';

/**
 * The §7.4 circuit breaker: a framework-wide ceiling on turns per rolling hour, and the stop for a
 * structural invariant broken at runtime (§3.10).
 *
 * The window is durable and the halt flag is not, which is the asymmetry §7.4 asks for. A halt does
 * not survive a restart because a restart abandons every in-flight turn and therefore breaks
 * whatever loop tripped it; the window does survive, because otherwise a crash-looping instance
 * grants itself a fresh 250 turns every boot with nobody deciding anything, and the framework-wide
 * number stops being true. So the count comes from the store and the ceiling is re-evaluated at the
 * first turn start after boot.
 */
@Injectable()
export class HaltService {
  private readonly ceiling: number;
  private haltedFor: HaltReason | undefined;

  constructor(
    private readonly approvalsService: ApprovalsService,
    configService: ConfigService,
    private readonly loggingService: LoggingService,
    private readonly notificationsService: NotificationsService,
    private readonly rosterService: RosterService,
    private readonly turnsService: TurnsService,
    @InjectModel('ResumeWatermark') private readonly watermarks: Model<'ResumeWatermark'>
  ) {
    this.ceiling = configService.get('turns.hourlyCeiling');
  }

  /**
   * Counts a turn against the rolling hour; the turn past the ceiling is refused and raises the
   * halt. Refused is the point — that turn is the one a runaway loop generates.
   *
   * The turn being admitted is not yet in the table, so this asks whether the ceiling was already
   * reached without it. Concurrent admissions can each read the same count and both pass: the
   * ceiling is an emergency brake on a runaway chain, not a quota, and overshooting it by the number
   * of turns starting in the same instant costs nothing the halt does not then catch.
   */
  async admitTurnStart(): Promise<boolean> {
    if (this.haltedFor) {
      return false;
    }
    if ((await this.countTurnsInWindow()) >= this.ceiling) {
      await this.halt({ ceiling: this.ceiling, kind: 'turn-ceiling' });
      return false;
    }
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
   * violation would return the system to the exact state that tripped it (§8.4). A ceiling halt
   * clears on the human's authority: advancing the watermark to now is what resets the window, and
   * it is durable so the reset survives the restart that may well follow.
   */
  async resume(byUsername: string): Promise<Result<void, HaltFailure>> {
    if (!this.haltedFor) {
      return Result.err({ kind: 'not-halted' });
    }
    const violation = this.rosterService.findRespondToAllViolation();
    if (violation) {
      return Result.err({ channelId: violation.channelId, kind: 'violation-standing' });
    }
    this.loggingService.warn(`global halt cleared by ${byUsername}`);
    this.haltedFor = undefined;
    const resumedAt = new Date();
    await this.watermarks.upsert({
      create: { key: WATERMARK_KEY, resumedAt },
      update: { resumedAt },
      where: { key: WATERMARK_KEY }
    });
    return Result.ok();
  }

  /** the trailing hour, or however much of it a `/resume` has left — whichever window is shorter */
  private async countTurnsInWindow(): Promise<number> {
    const watermark = await this.watermarks.findUnique({ where: { key: WATERMARK_KEY } });
    const hourAgo = new Date(Date.now() - ROLLING_HOUR_MS);
    const opensAt = watermark && watermark.resumedAt > hourAgo ? watermark.resumedAt : hourAgo;
    return this.turnsService.countStartedAfter(opensAt);
  }
}
