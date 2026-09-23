import type { OpenUnitSummary } from '@/tasks/tasks.types.ts';
import { renderOpenUnitLine } from '@/tasks/tasks.utils.ts';

import { renderParkedOn } from './approvals.utils.ts';

import type { ParkedDecision } from './approvals.utils.ts';

/** §3.15 — whose turns the listing speaks for: the agent, and the other side of each of its units */
export function listUnitParties(agentUsername: string, units: readonly OpenUnitSummary[]): ReadonlySet<string> {
  return new Set([
    agentUsername,
    ...units.map((unit) => (unit.creatorUsername === agentUsername ? unit.assigneeUsername : unit.creatorUsername))
  ]);
}

/**
 * §8.4 — the same lines the agent reads in its prompt, so a human and the agent see one listing;
 * then each party whose turn here waits on a person, since a unit on either side of a parked turn
 * moves only once someone decides (§8.1).
 */
export function renderUnitsListing(
  agentUsername: string,
  units: readonly OpenUnitSummary[],
  parked: readonly ParkedDecision[],
  now: Date
): string {
  const work =
    units.length === 0
      ? [`${agentUsername} has no open work in this channel.`]
      : [
          `Open work for ${agentUsername} in this channel:`,
          ...units.map((unit) => `- ${renderOpenUnitLine(unit, agentUsername, now)}`)
        ];
  const waiting =
    parked.length === 0
      ? []
      : [
          'Waiting on a person in this channel:',
          ...parked.map((parkedOn) => `- ${parkedOn.decision.agentUsername} · ${renderParkedOn(parkedOn, now)}`)
        ];
  return [...work, ...waiting].join('\n');
}
