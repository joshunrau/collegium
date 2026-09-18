import type { OpenUnitSummary } from '@/tasks/tasks.types.ts';
import { renderOpenUnitLine } from '@/tasks/tasks.utils.ts';

/** §8.4 — the same lines the agent reads in its prompt, so a human and the agent see one listing */
export function renderUnitsListing(agentUsername: string, units: readonly OpenUnitSummary[], now: Date): string {
  return [
    `Open work for ${agentUsername} in this channel:`,
    ...units.map((unit) => `- ${renderOpenUnitLine(unit, agentUsername, now)}`)
  ].join('\n');
}
