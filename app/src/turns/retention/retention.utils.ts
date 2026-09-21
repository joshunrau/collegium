import { createHash } from 'node:crypto';

import type { AgentProfile } from '@/agents/agents.types.ts';

import { SUPERSEDABLE_RETENTION_SHARE } from './retention.constants.ts';

/** §3.8 — the tokens of supersedable results a turn keeps verbatim past the floor, from the model's own window */
export function retentionBudgetFor(profile: Pick<AgentProfile, 'contextWindowTokens'>): number {
  return Math.floor(profile.contextWindowTokens * SUPERSEDABLE_RETENTION_SHARE);
}

/** §3.8 — the identity of a result's text, so a byte-identical repeat is recognised as one */
export function hashResult(output: string): string {
  return createHash('sha256').update(output).digest('hex');
}
