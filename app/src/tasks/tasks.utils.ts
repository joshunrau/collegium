import { match } from 'ts-pattern';

import { renderElapsed } from '@/formatting/durations/duration.utils.ts';
import type { WorkUnitState } from '@/prisma/prisma.types.ts';
import { renderReference } from '@/utils/reference.utils.ts';

import { renderCounterpartState } from './counterparts/counterpart-state.utils.ts';

import type {
  CounterpartWording,
  OpenUnitState,
  OpenUnitSummary,
  PreparedUnit,
  TaskFailure,
  UnitView,
  WorkUnit
} from './tasks.types.ts';

function renderClosedUnit(closed: TaskFailure.Closed, now: Date): string {
  const ago = `${renderElapsed(now.getTime() - closed.closedAt.getTime())} ago`;
  const closer =
    closed.closedByUsername === null
      ? `it was closed as ${closed.state} ${ago}`
      : `@${closed.closedByUsername} closed it as ${closed.state} ${ago}`;
  const verdict = closed.verdict === null ? '' : `, with the verdict "${closed.verdict}"`;
  return `unit ${closed.reference} is closed: ${closer}${verdict}`;
}

/** §3.15 — the assignee finishes by moving to review; done is the creator's verdict after reading it */
export const ASSIGNEE_TARGETS = ['blocked', 'review'] as const satisfies readonly WorkUnitState[];

/** §3.15 — only the agent that handed the unit over closes it */
export const CREATOR_TARGETS = ['cancelled', 'done'] as const satisfies readonly WorkUnitState[];

export const OPEN_STATES = ['assigned', 'blocked', 'review'] as const satisfies readonly OpenUnitState[];

export const LEGAL_FROM: { readonly [State in WorkUnitState]: readonly WorkUnitState[] } = {
  assigned: ['blocked', 'cancelled', 'done', 'review'],
  blocked: ['cancelled', 'review'],
  cancelled: [],
  done: [],
  review: ['cancelled', 'done']
};

/** the states a transition to `target` may leave from — the commit's own guard against a row that moved under it */
export function statesThatMayReach(target: WorkUnitState): WorkUnitState[] {
  return (Object.keys(LEGAL_FROM) as WorkUnitState[]).filter((from) => LEGAL_FROM[from].includes(target));
}

/** §3.15 — in review or blocked, the unit's last post is its assignee's report, which a close judges */
export function awaitsVerdictOnReport(state: WorkUnitState): boolean {
  return (ASSIGNEE_TARGETS as readonly WorkUnitState[]).includes(state);
}

export function isOpenUnit(unit: WorkUnit): unit is WorkUnit & { state: OpenUnitState } {
  return (OPEN_STATES as readonly WorkUnitState[]).includes(unit.state);
}

/** why the unit may not move to `target`, if it may not: a closed unit says who closed it, when, and the verdict (§3.15) */
export function findTransitionRefusal(
  unit: WorkUnit,
  target: WorkUnitState
): TaskFailure.TransitionRefused | undefined {
  if (unit.state === 'cancelled' || unit.state === 'done') {
    return {
      closedAt: unit.closedAt ?? unit.updatedAt,
      closedByUsername: unit.closedByUsername,
      kind: 'closed',
      reference: renderReference(unit.id),
      state: unit.state,
      verdict: unit.verdict
    };
  }
  if (!LEGAL_FROM[unit.state].includes(target)) {
    return { from: unit.state, kind: 'illegal-transition', to: target };
  }
  return undefined;
}

/** whether an agent's grants let it answer through the record — a namespace grant or the one tool by ref (§8) */
export function holdsReportTool(grants: readonly string[]): boolean {
  return grants.includes('tasks') || grants.includes('tasks::report');
}

export function renderAssignmentPost(prepared: PreparedUnit): string {
  return [
    `@${prepared.assigneeUsername} — work unit \`${renderReference(prepared.id)}\``,
    `**Outcome:** ${prepared.outcome}`,
    `**Criteria:** ${prepared.criteria}`,
    `**Context:** ${prepared.context}`
  ].join('\n\n');
}

export function renderReportPost(unit: WorkUnit, to: (typeof ASSIGNEE_TARGETS)[number], summary: string): string {
  const state = to === 'review' ? 'ready for review' : 'blocked';
  return `@${unit.creatorUsername} — unit \`${renderReference(unit.id)}\` is ${state}: ${summary}`;
}

export function renderClosePost(unit: WorkUnit, to: (typeof CREATOR_TARGETS)[number], verdict: string): string {
  return `Unit \`${renderReference(unit.id)}\` closed as ${to}: ${verdict}`;
}

/** the agents are named by display name, not @: a mention from the system bot would start the turns this cancellation spares */
export function renderHumanCancellationPost(
  unit: WorkUnit,
  byUsername: string,
  names: { readonly assignee: string; readonly creator: string }
): string {
  return `⛔ Unit \`${renderReference(unit.id)}\` cancelled by @${byUsername} — ${names.creator} had handed it to ${names.assignee}: ${unit.outcome}`;
}

/** §3.15 — the agent reading its own units: what is awaited of it is "your", and a colleague's wait on a person is named */
export function wordingForAgent(formatMoment: (moment: Date) => string): CounterpartWording {
  return { formatMoment, namesPersonWait: true, readerPossessive: 'your' };
}

/** §8.4 — a person reading an agent's units: what is awaited of the agent is under its name, and a wait on a person is left to the listing's own list */
export function wordingForPerson(agentUsername: string, formatMoment: (moment: Date) => string): CounterpartWording {
  return { formatMoment, namesPersonWait: false, readerPossessive: `${agentUsername}'s` };
}

/**
 * §3.15 — the full record, for tasks::read: what the prompt line abbreviates, the counterpart's state
 * beside its name, and the post of the latest change delimited rather than requoted, since a verdict
 * rests on its words
 */
export function renderUnitView(
  { counterpart, latestChange, unit }: UnitView,
  readerUsername: string,
  wording: CounterpartWording
): string {
  const standing = counterpart === undefined ? '' : ` (${renderCounterpartState(counterpart, wording)})`;
  const readerCreated = unit.creatorUsername === readerUsername;
  const changed = latestChange.kind === 'none' ? '' : `, last changed ${wording.formatMoment(unit.updatedAt)}`;
  const record = [
    `unit ${renderReference(unit.id)} — ${unit.state}`,
    `assigned ${wording.formatMoment(unit.createdAt)}${changed}`,
    `creator: @${unit.creatorUsername}${readerCreated ? '' : standing}`,
    `assignee: @${unit.assigneeUsername}${readerCreated ? standing : ''}`,
    `outcome: ${unit.outcome}`,
    `criteria: ${unit.criteria}`,
    `context: ${unit.context}`
  ].join('\n');
  const change = awaitsVerdictOnReport(unit.state) ? 'report' : 'close';
  return match(latestChange)
    .with({ kind: 'none' }, () => record)
    .with({ kind: 'posted' }, ({ post }) => `${record}\n\nlatest ${change}:\n<<<post ${post.id}\n${post.message}\n>>>`)
    .with(
      { kind: 'unreadable' },
      () => `${record}\n\nlatest ${change}: its post was forgotten, so it can no longer be read`
    )
    .exhaustive();
}

/** one line of the prompt block: the counterpart from this agent's side and where it stands, the state, the age, the outcome (§3.15) */
export function renderOpenUnitLine(
  unit: OpenUnitSummary,
  readerUsername: string,
  now: Date,
  wording: CounterpartWording
): string {
  const counterpart =
    unit.creatorUsername === readerUsername ? `to @${unit.assigneeUsername}` : `from @${unit.creatorUsername}`;
  const standing = renderCounterpartState(unit.counterpart, wording);
  return `[${unit.reference}] ${counterpart} (${standing}) · ${unit.state} · ${renderElapsed(now.getTime() - unit.createdAt.getTime())} — ${unit.outcome}`;
}

export function renderUnresolvedUnit(failure: TaskFailure.Unresolved): string {
  return failure.kind === 'not-found'
    ? `no work unit with reference "${failure.reference}" exists for you in this channel`
    : `reference "${failure.reference}" matches more than one work unit`;
}

/** every refusal names its rule and nothing the agent was not already told (§7.2) */
export function renderTaskRefusal(failure: TaskFailure, now = new Date()): string {
  return match(failure)
    .with({ kind: 'ambiguous' }, { kind: 'not-found' }, (unresolved) => renderUnresolvedUnit(unresolved))
    .with({ kind: 'assignee-absent' }, ({ assigneeUsername }) => `@${assigneeUsername} is not in this channel`)
    .with(
      { kind: 'assignee-cannot-report' },
      ({ assigneeUsername }) => `@${assigneeUsername} holds no tasks tool, so it could not report back through a unit`
    )
    .with(
      { kind: 'assignee-working' },
      ({ assigneeUsername, reference }) =>
        `unit ${reference} is still being worked on: the turn @${assigneeUsername} started here after it was assigned has not ended, so it cannot close yet. A report from that turn starts your next one, where you can close it; a person can cancel it at once with /collegium units`
    )
    .with({ kind: 'cap-reached' }, ({ cap }) => `you already hold ${cap} open units in this channel, the cap`)
    .with(
      { kind: 'chain-limit' },
      () => 'this chain has reached its limit of turns, so no further hand-off runs (§7.4)'
    )
    .with({ kind: 'closed' }, (closed) => renderClosedUnit(closed, now))
    .with(
      { kind: 'depth-limit' },
      () => 'this turn is at the delegation depth limit, so no further hand-off runs (§7.4)'
    )
    .with({ kind: 'illegal-transition' }, ({ from, to }) => `a unit in ${from} cannot move to ${to}`)
    .with(
      { kind: 'not-the-assignee' },
      ({ assigneeUsername }) => `only the assignee, @${assigneeUsername}, reports on this unit`
    )
    .with(
      { kind: 'not-the-creator' },
      ({ creatorUsername }) => `only the creator, @${creatorUsername}, closes this unit`
    )
    .with(
      { kind: 'report-unread' },
      ({ reference }) =>
        `the latest report on unit ${reference} is not in what this turn has read; read it with tasks__read, then close the unit`
    )
    .with({ kind: 'self-assignment' }, () => 'a unit is handed to a colleague, not to yourself')
    .exhaustive();
}
