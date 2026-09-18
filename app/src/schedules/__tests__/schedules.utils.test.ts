import type { $ScheduleRecurrence } from '@collegium/config';
import { describe, expect, it } from 'vitest';

import { latestOccurrence, nextOccurrence, zonedInstant } from '../schedules.utils.ts';

const LOS_ANGELES = 'America/Los_Angeles';

const DAILY_AT_NINE: $ScheduleRecurrence = { at: '09:00', every: 'day' };

const latest = (recurrence: $ScheduleRecurrence, after: string, now: string, timezone = LOS_ANGELES) => {
  return latestOccurrence(recurrence, timezone, { after: new Date(after), now: new Date(now) })?.toISOString();
};

describe('latestOccurrence', () => {
  it('should return the most recent occurrence after the mark and at or before now', () => {
    expect(latest(DAILY_AT_NINE, '2026-09-14T00:00:00Z', '2026-09-16T20:00:00Z')).toBe('2026-09-16T16:00:00.000Z');
  });

  it('should return nothing when the only occurrence is at or before the mark', () => {
    expect(latest(DAILY_AT_NINE, '2026-09-16T16:00:00Z', '2026-09-16T20:00:00Z')).toBeUndefined();
  });

  it('should announce one firing for a week of missed occurrences', () => {
    expect(latest(DAILY_AT_NINE, '2026-09-09T00:00:00Z', '2026-09-16T20:00:00Z')).toBe('2026-09-16T16:00:00.000Z');
  });

  it('should read the time as a wall clock on both sides of a DST transition', () => {
    expect(latest(DAILY_AT_NINE, '2026-10-30T00:00:00Z', '2026-10-31T20:00:00Z')).toBe('2026-10-31T16:00:00.000Z');
    expect(latest(DAILY_AT_NINE, '2026-11-01T00:00:00Z', '2026-11-02T20:00:00Z')).toBe('2026-11-02T17:00:00.000Z');
  });

  it('should skip the weekend for a weekday recurrence', () => {
    // Monday 2026-09-14 in Los Angeles, asked for on the Sunday after
    expect(latest({ at: '09:00', every: 'weekday' }, '2026-09-13T00:00:00Z', '2026-09-20T20:00:00Z')).toBe(
      '2026-09-18T16:00:00.000Z'
    );
  });

  it('should fire a monthly recurrence in February', () => {
    expect(
      latest({ at: '09:00', every: 'month', onDayOfMonth: 28 }, '2026-02-01T00:00:00Z', '2026-03-05T00:00:00Z')
    ).toBe('2026-02-28T17:00:00.000Z');
  });

  it('should fire an hourly recurrence once an hour', () => {
    expect(latest({ atMinute: 5, every: 'hour' }, '2026-09-16T19:30:00Z', '2026-09-16T20:30:00Z')).toBe(
      '2026-09-16T20:05:00.000Z'
    );
    expect(latest({ atMinute: 5, every: 'hour' }, '2026-09-16T20:05:00Z', '2026-09-16T20:30:00Z')).toBeUndefined();
  });
});

describe('zonedInstant', () => {
  it('should resolve a nonexistent wall clock forward past the skipped hour', () => {
    const skipped = zonedInstant('America/New_York', { day: 8, hour: 2, minute: 30, month: 3, year: 2026 });
    expect(skipped.toISOString()).toBe('2026-03-08T07:30:00.000Z');
  });

  it('should resolve an ambiguous wall clock to the earlier of its two instants', () => {
    const repeated = zonedInstant('America/New_York', { day: 1, hour: 1, minute: 30, month: 11, year: 2026 });
    expect(repeated.toISOString()).toBe('2026-11-01T05:30:00.000Z');
  });
});

describe('nextOccurrence', () => {
  it('should be strictly after the moment asked about', () => {
    const from = new Date('2026-09-16T16:00:00Z');
    expect(nextOccurrence(DAILY_AT_NINE, LOS_ANGELES, from).toISOString()).toBe('2026-09-17T16:00:00.000Z');
  });
});
