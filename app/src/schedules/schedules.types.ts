import type { $ScheduleRecurrence } from '@collegium/config';

/** one declared schedule with its channel resolved: the shape the ticker works from (§4.2) */
export type ScheduleRuntime = {
  readonly agentUsername: string;
  /** the handle as config names it, for anything a human reads */
  readonly channel: string;
  readonly channelId: string;
  readonly handle: string;
  /** "{agentUsername}:{handle}" — the ScheduleState primary key */
  readonly id: string;
  readonly prompt: string;
  readonly recurrence: $ScheduleRecurrence;
  readonly timezone: string;
};

/** the window a tick asks about: the occurrence already announced, and the moment now */
export type OccurrenceQuery = {
  readonly after: Date;
  readonly now: Date;
};

/** a declared schedule and the moment it next fires — what /collegium inspect lists (§8.4) */
export type UpcomingSchedule = {
  readonly channel: string;
  readonly handle: string;
  readonly nextOccurrenceAt: Date;
};
