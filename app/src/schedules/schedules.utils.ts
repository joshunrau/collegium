import type { $ScheduleRecurrence, $Weekday } from '@collegium/config';

import type { OccurrenceQuery } from './schedules.types.ts';

type ZonedDate = {
  readonly day: number;
  readonly month: number;
  readonly year: number;
};

type ZonedMoment = ZonedDate & {
  readonly hour: number;
  readonly minute: number;
};

/** every recurrence but the hourly one names a wall-clock time on some day */
type DatedRecurrence = Exclude<$ScheduleRecurrence, { every: 'hour' }>;

const HOUR_MS = 3_600_000;

const MINUTE_MS = 60_000;

const DAY_MS = 86_400_000;

/** the sparsest recurrence lands once a month, so a walk of 40 days always meets one */
const OCCURRENCE_WALK_DAYS = 40;

const WEEKDAY_INDEX: { readonly [Day in $Weekday]: number } = {
  friday: 5,
  monday: 1,
  saturday: 6,
  sunday: 0,
  thursday: 4,
  tuesday: 2,
  wednesday: 3
};

const formatterFor = (options: Intl.DateTimeFormatOptions) => {
  const byTimezone = new Map<string, Intl.DateTimeFormat>();
  return (timezone: string): Intl.DateTimeFormat => {
    const existing = byTimezone.get(timezone);
    if (existing) {
      return existing;
    }
    const created = new Intl.DateTimeFormat('en-US', { ...options, timeZone: timezone });
    byTimezone.set(timezone, created);
    return created;
  };
};

const momentFormatter = formatterFor({
  day: '2-digit',
  hour: '2-digit',
  hourCycle: 'h23',
  minute: '2-digit',
  month: '2-digit',
  year: 'numeric'
});

const offsetFormatter = formatterFor({ timeZoneName: 'longOffset' });

function zoneOffsetMs(timezone: string, instant: Date): number {
  const name = offsetFormatter(timezone)
    .formatToParts(instant)
    .find((part) => part.type === 'timeZoneName')?.value;
  if (name === 'GMT') {
    return 0;
  }
  const [, sign, hours, minutes] = /^GMT([+-])(\d{2}):(\d{2})$/.exec(name ?? '') ?? [];
  if (sign === undefined) {
    throw new Error(`the offset of timezone "${timezone}" could not be read from "${name}"`);
  }
  return (sign === '-' ? -1 : 1) * (Number(hours) * HOUR_MS + Number(minutes) * MINUTE_MS);
}

function zonedMoment(timezone: string, instant: Date): ZonedMoment {
  const parts = momentFormatter(timezone).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes) => {
    return Number(parts.find((part) => part.type === type)?.value);
  };
  return { day: read('day'), hour: read('hour'), minute: read('minute'), month: read('month'), year: read('year') };
}

function isSameMoment(left: ZonedMoment, right: ZonedMoment): boolean {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute
  );
}

function shiftDays(date: ZonedDate, days: number): ZonedDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day) + days * DAY_MS);
  return { day: shifted.getUTCDate(), month: shifted.getUTCMonth() + 1, year: shifted.getUTCFullYear() };
}

function weekdayOf({ day, month, year }: ZonedDate): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function matchesDay(recurrence: DatedRecurrence, date: ZonedDate): boolean {
  switch (recurrence.every) {
    case 'day':
      return true;
    case 'month':
      return date.day === recurrence.onDayOfMonth;
    case 'week':
      return weekdayOf(date) === WEEKDAY_INDEX[recurrence.onDay];
    case 'weekday': {
      const weekday = weekdayOf(date);
      return weekday >= WEEKDAY_INDEX.monday && weekday <= WEEKDAY_INDEX.friday;
    }
  }
}

function timeOfDay(at: string): { hour: number; minute: number } {
  const [hour = '0', minute = '0'] = at.split(':');
  return { hour: Number(hour), minute: Number(minute) };
}

function datedOccurrence(recurrence: DatedRecurrence, timezone: string, from: Date, direction: -1 | 1): Date {
  const start = zonedMoment(timezone, from);
  for (let step = 0; step <= OCCURRENCE_WALK_DAYS; step++) {
    const date = shiftDays(start, step * direction);
    if (!matchesDay(recurrence, date)) {
      continue;
    }
    const candidate = zonedInstant(timezone, { ...date, ...timeOfDay(recurrence.at) });
    if (direction === -1 ? candidate <= from : candidate > from) {
      return candidate;
    }
  }
  throw new Error(`a "${recurrence.every}" recurrence has no occurrence within ${OCCURRENCE_WALK_DAYS} days`);
}

function hourlyOccurrence(atMinute: number, timezone: string, from: Date, direction: -1 | 1): Date {
  const thisHour = zonedInstant(timezone, { ...zonedMoment(timezone, from), minute: atMinute });
  if (direction === -1 ? thisHour <= from : thisHour > from) {
    return thisHour;
  }
  const stepped = zonedMoment(timezone, new Date(from.getTime() + direction * HOUR_MS));
  return zonedInstant(timezone, { ...stepped, minute: atMinute });
}

/**
 * §4.2 — the most recent occurrence still unannounced: at or before `now`, strictly after the
 * occurrence already announced. One firing however many were missed, since only the latest is
 * returned; undefined when nothing has come due since.
 */
export function latestOccurrence(
  recurrence: $ScheduleRecurrence,
  timezone: string,
  { after, now }: OccurrenceQuery
): Date | undefined {
  const occurrence =
    recurrence.every === 'hour'
      ? hourlyOccurrence(recurrence.atMinute, timezone, now, -1)
      : datedOccurrence(recurrence, timezone, now, -1);
  return occurrence > after ? occurrence : undefined;
}

/** the first occurrence strictly after `from` — what /collegium inspect shows (§8.4) */
export function nextOccurrence(recurrence: $ScheduleRecurrence, timezone: string, from: Date): Date {
  return recurrence.every === 'hour'
    ? hourlyOccurrence(recurrence.atMinute, timezone, from, 1)
    : datedOccurrence(recurrence, timezone, from, 1);
}

/**
 * The instant a wall clock in `timezone` reads `moment`. The offsets a day either side bracket any
 * transition the reading could fall across, so both readings of an ambiguous wall clock are
 * candidates: the repeated hour autumn brings takes the earlier instant, and the hour spring skips —
 * a reading no clock there ever shows — resolves forward, onto the first instant that does exist.
 */
export function zonedInstant(timezone: string, moment: ZonedMoment): Date {
  const naive = Date.UTC(moment.year, moment.month - 1, moment.day, moment.hour, moment.minute);
  const offsets = new Set([
    zoneOffsetMs(timezone, new Date(naive + DAY_MS)),
    zoneOffsetMs(timezone, new Date(naive - DAY_MS))
  ]);
  const candidates = Array.from(offsets, (offset) => new Date(naive - offset)).toSorted((left, right) => {
    return left.getTime() - right.getTime();
  });
  const existing = candidates.filter((candidate) => isSameMoment(zonedMoment(timezone, candidate), moment));
  return existing[0] ?? candidates.at(-1)!;
}
