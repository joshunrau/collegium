import { createHash } from 'node:crypto';

import type { AgentProfile } from '@/agents/agents.types.ts';

import { SUPERSEDABLE_RETENTION_SHARE } from './retention.constants.ts';

/** §3.8 — the tokens of supersedable results a turn keeps verbatim past the floor, from the agent's turn ceiling */
export function retentionBudgetFor(profile: Pick<AgentProfile, 'turnContextCeilingTokens'>): number {
  return Math.floor(profile.turnContextCeilingTokens * SUPERSEDABLE_RETENTION_SHARE);
}

/** §3.8 — the identity of a result's text, so a byte-identical repeat is recognised as one */
export function hashResult(output: string): string {
  return createHash('sha256').update(output).digest('hex');
}
