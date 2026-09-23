import { match } from 'ts-pattern';

import type { AwaitedMove, CounterpartState, CounterpartWording, PersonWait } from '../tasks.types.ts';

/** the change a party's move answers: an assignee reports on the assignment, a creator judges the report */
const ANSWERED_CHANGE: { readonly [Move in AwaitedMove]: string } = {
  report: 'the assignment',
  verdict: 'the report'
};

const MOVE_NOT_MADE: { readonly [Move in AwaitedMove]: string } = {
  report: 'without reporting',
  verdict: 'without a verdict'
};

/** §8.1 — worded as the waiting turn's status post heads it */
const PERSON_WAITS: { readonly [On in PersonWait['on']]: string } = {
  approval: 'waiting on a decision',
  ask: 'waiting on an answer'
};

/** §3.15 — one phrase, in the terms a line or record names the counterpart by */
export function renderCounterpartState(state: CounterpartState, wording: CounterpartWording): string {
  return match(state)
    .with({ kind: 'awaiting-reader' }, ({ awaited, since }) => {
      return `awaiting ${wording.readerPossessive} ${awaited} since ${wording.formatMoment(since)}`;
    })
    .with({ kind: 'in-turn' }, ({ awaited, beganBeforeChange, since, waitingOn }) => {
      const activity =
        waitingOn !== undefined && wording.namesPersonWait
          ? `${PERSON_WAITS[waitingOn.on]} since ${wording.formatMoment(waitingOn.since)}`
          : `working here since ${wording.formatMoment(since)}`;
      return beganBeforeChange ? `${activity}, in a turn begun before ${ANSWERED_CHANGE[awaited]}` : activity;
    })
    .with({ kind: 'turn-ended' }, ({ awaited, endedAt }) => {
      return `last turn here ended ${wording.formatMoment(endedAt)} ${MOVE_NOT_MADE[awaited]}`;
    })
    .with({ kind: 'no-turn' }, ({ awaited }) => `no turn here since ${ANSWERED_CHANGE[awaited]}`)
    .exhaustive();
}
