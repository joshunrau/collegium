import { Injectable } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';

import { LoggingService } from '@/logging/logging.service.ts';
import { InjectModel } from '@/prisma/prisma.decorators.ts';
import type { Model } from '@/prisma/prisma.types.ts';
import { TriggersService } from '@/triggers/triggers.service.ts';
import type { TriggerFailure } from '@/triggers/triggers.types.ts';

import { SCHEDULE_TICK_MS } from './schedules.constants.ts';
import { SchedulesRegistry } from './schedules.registry.ts';
import { latestOccurrence } from './schedules.utils.ts';

import type { ScheduleRuntime } from './schedules.types.ts';

/** every firing of one schedule shares this prefix, which is how the series is found again (§4.2) */
const seriesKey = (schedule: ScheduleRuntime) => `cron:${schedule.id}:`;

/**
 * §4.2's schedule adapter: deterministic code that reads the declared schedules and records a
 * trigger row per occurrence that has come due. It never posts and never starts a turn — announcing
 * is the system bot's, gated on the channel being idle.
 *
 * The ordering is the guarantee: the row is recorded durably *before* the mark advances, so a crash
 * in between re-attempts the same occurrence and the dedupe key absorbs the repeat. Advancing first
 * would drop a firing nobody ever sees.
 */
@Injectable()
export class SchedulesService implements OnApplicationShutdown {
  /** a configuration fact reported once per process, rather than every thirty seconds until it is fixed */
  private readonly reportedRefusals = new Set<string>();
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly loggingService: LoggingService,
    private readonly schedulesRegistry: SchedulesRegistry,
    private readonly triggersService: TriggersService,
    @InjectModel('ScheduleState') private readonly states: Model<'ScheduleState'>
  ) {}

  onApplicationShutdown(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /**
   * State follows config: a schedule declared since the last boot starts with no past, so its first
   * tick cannot announce an occurrence from before it existed, and one no longer declared leaves
   * nothing behind.
   */
  async reconcile(): Promise<void> {
    const declared = this.schedulesRegistry.list();
    for (const schedule of declared) {
      await this.states.upsert({ create: { id: schedule.id }, update: {}, where: { id: schedule.id } });
    }
    await this.states.deleteMany({ where: { id: { notIn: declared.map(({ id }) => id) } } });
  }

  /** called once, after the roster has reconciled: intake refuses against an empty roster */
  start(): void {
    this.timer = setInterval(() => void this.tickOnce(), SCHEDULE_TICK_MS);
    this.timer.unref();
  }

  /** exposed for tests; a tick never throws, so one bad schedule cannot kill the timer */
  async tickOnce(): Promise<void> {
    for (const schedule of this.schedulesRegistry.list()) {
      try {
        await this.announceIfDue(schedule);
      } catch (error) {
        this.loggingService.error(new Error(`the schedule "${schedule.id}" could not be ticked`, { cause: error }));
      }
    }
  }

  private async advance(schedule: ScheduleRuntime, occurrence: Date): Promise<void> {
    await this.states.update({ data: { lastFiredFor: occurrence }, where: { id: schedule.id } });
  }

  private async announceIfDue(schedule: ScheduleRuntime): Promise<void> {
    const state = await this.states.findUnique({ where: { id: schedule.id } });
    if (!state) {
      throw new Error(`no state row was reconciled for the schedule "${schedule.id}"`);
    }
    const occurrence = latestOccurrence(schedule.recurrence, schedule.timezone, {
      after: state.lastFiredFor ?? state.firstSeenAt,
      now: new Date()
    });
    if (occurrence === undefined) {
      return;
    }
    const recorded = await this.triggersService.record({
      dedupeKey: `${seriesKey(schedule)}${occurrence.toISOString()}`,
      reference: { body: schedule.prompt, id: schedule.handle, subject: schedule.handle },
      source: 'cron',
      targetAgentUsername: schedule.agentUsername,
      targetChannelId: schedule.channelId
    });
    if (!recorded.success) {
      this.reportRefusal(schedule, recorded.error);
      if (recorded.error.kind !== 'channel-unreachable') {
        await this.advance(schedule, occurrence);
      }
      return;
    }
    await this.triggersService.resolveSupersededBy(recorded.value, seriesKey(schedule));
    await this.advance(schedule, occurrence);
  }

  /**
   * A substrate that could not be reached is retried on the next tick, so it is reported every time
   * and the mark stays where it is. Every other refusal is a configuration fact no retry can change,
   * so the mark advances past the occurrence and the log says so once.
   */
  private reportRefusal(schedule: ScheduleRuntime, failure: TriggerFailure): void {
    const reported = new Error(`the schedule "${schedule.id}" could not be announced: ${JSON.stringify(failure)}`);
    if (failure.kind === 'channel-unreachable') {
      this.loggingService.error(reported);
      return;
    }
    if (this.reportedRefusals.has(schedule.id)) {
      return;
    }
    this.reportedRefusals.add(schedule.id);
    this.loggingService.error(reported);
  }
}
