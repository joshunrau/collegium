import { match } from 'ts-pattern';

import { renderElapsed } from '@/formatting/durations/duration.utils.ts';
import type { WorkUnitState } from '@/prisma/prisma.types.ts';
import { renderReference } from '@/utils/reference.utils.ts';

import type { OpenUnitSummary, PreparedUnit, TaskFailure, WorkUnit } from './tasks.types.ts';

/** §3.15 — the assignee finishes by moving to review; done is the creator's verdict after reading it */
export const ASSIGNEE_TARGETS = ['blocked', 'review'] as const satisfies readonly WorkUnitState[];

/** §3.15 — only the agent that handed the unit over closes it */
export const CREATOR_TARGETS = ['cancelled', 'done'] as const satisfies readonly WorkUnitState[];

export const OPEN_STATES = ['assigned', 'blocked', 'review'] as const satisfies readonly WorkUnitState[];

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

/** the full record, for tasks::read: what the prompt line abbreviates */
export function renderUnitRecord(unit: WorkUnit): string {
  return [
    `unit ${renderReference(unit.id)} — ${unit.state}`,
    `creator: @${unit.creatorUsername}`,
    `assignee: @${unit.assigneeUsername}`,
    `outcome: ${unit.outcome}`,
    `criteria: ${unit.criteria}`,
    `context: ${unit.context}`
  ].join('\n');
}

/** one line of the prompt block: the counterpart from this agent's side, the state, the age, the outcome (§3.15) */
export function renderOpenUnitLine(unit: OpenUnitSummary, selfUsername: string, now: Date): string {
  const counterpart =
    unit.creatorUsername === selfUsername ? `to @${unit.assigneeUsername}` : `from @${unit.creatorUsername}`;
  return `[${unit.reference}] ${counterpart} · ${unit.state} · ${renderElapsed(now.getTime() - unit.createdAt.getTime())} — ${unit.outcome}`;
}

export function renderUnresolvedUnit(failure: TaskFailure.Unresolved): string {
  return failure.kind === 'not-found'
    ? `no work unit with reference "${failure.reference}" exists for you in this channel`
    : `reference "${failure.reference}" matches more than one work unit`;
}

/** every refusal names its rule and nothing the agent was not already told (§7.2) */
export function renderTaskRefusal(failure: TaskFailure): string {
  return match(failure)
    .with({ kind: 'ambiguous' }, { kind: 'not-found' }, (unresolved) => renderUnresolvedUnit(unresolved))
    .with({ kind: 'assignee-absent' }, ({ assigneeUsername }) => `@${assigneeUsername} is not in this channel`)
    .with(
      { kind: 'assignee-cannot-report' },
      ({ assigneeUsername }) => `@${assigneeUsername} holds no tasks tool, so it could not report back through a unit`
    )
    .with({ kind: 'cap-reached' }, ({ cap }) => `you already hold ${cap} open units in this channel, the cap`)
    .with(
      { kind: 'chain-limit' },
      () => 'this chain has reached its limit of turns, so no further hand-off runs (§7.4)'
    )
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
    .with({ kind: 'self-assignment' }, () => 'a unit is handed to a colleague, not to yourself')
    .exhaustive();
}
