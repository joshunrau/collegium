import { describe, expect, it } from 'vitest';

import { wordingForAgent, wordingForPerson } from '../../tasks.utils.ts';
import { renderCounterpartState } from '../counterpart-state.utils.ts';

import type { CounterpartState } from '../../tasks.types.ts';

const formatMoment = (moment: Date) => `${moment.toISOString().slice(11, 16)} UTC`;

const nameOf = (username: string) => username.replace(/^./u, (first) => first.toUpperCase());

const AGENT = wordingForAgent(formatMoment, nameOf);

const PARKED: CounterpartState = {
  awaited: 'verdict',
  beganBeforeChange: true,
  kind: 'in-turn',
  since: new Date('2026-09-22T18:50:00Z'),
  waitingOn: { on: 'approval', since: new Date('2026-09-22T18:57:00Z') }
};

describe('renderCounterpartState', () => {
  it('should say whose move the unit awaits, and how the counterpart’s turns here stand (§3.15)', () => {
    const since = new Date('2026-09-22T19:02:00Z');
    expect(renderCounterpartState({ awaited: 'verdict', kind: 'awaiting-reader', since }, AGENT)).toBe(
      'awaiting your verdict since 19:02 UTC'
    );
    expect(renderCounterpartState({ awaited: 'report', endedAt: since, kind: 'turn-ended' }, AGENT)).toBe(
      'last turn here ended 19:02 UTC without reporting'
    );
    expect(renderCounterpartState({ awaited: 'verdict', kind: 'no-turn' }, AGENT)).toBe(
      'no turn here since the report'
    );
    expect(renderCounterpartState(PARKED, AGENT)).toBe(
      'waiting on a decision since 18:57 UTC, in a turn begun before the report'
    );
  });

  it('should name the agent to a person, and leave a wait on a person to the listing that states it (§8.4)', () => {
    const person = wordingForPerson('mira', formatMoment, nameOf);
    expect(renderCounterpartState({ awaited: 'report', kind: 'awaiting-reader', since: new Date(0) }, person)).toBe(
      "awaiting Mira's report since 00:00 UTC"
    );
    expect(renderCounterpartState(PARKED, person)).toBe(
      'working here since 18:50 UTC, in a turn begun before the report'
    );
  });
});
