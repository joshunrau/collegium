import { createHash } from 'node:crypto';

import type { ToolExcerpt } from '@collegium/core/tools';

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

/**
 * §3.8 — what a result cut to fit the turn's ceiling ends with: how much of it the turn holds, and
 * where a stretch of a longer whole reads on from, since the cut drops the result's own word on
 * that. The trace holds the whole, but the model cannot read the trace.
 */
export function renderResultCutMarker(input: {
  excerpt: ToolExcerpt | undefined;
  keptChars: number;
  totalChars: number;
}): string {
  const held = `\n…result cut to its first ${input.keptChars} of ${input.totalChars} characters to fit this turn's context`;
  if (input.excerpt === undefined) {
    return held;
  }
  const { from, offsetArgument, textIndex, to } = input.excerpt;
  const readOnFrom = from + Math.min(Math.max(input.keptChars - textIndex, 0), to - from);
  return `${held}; read on with ${offsetArgument}=${readOnFrom}`;
}

/** §3.8 — an excerpt as it sits in the message the turn pushed, whose output begins `outputAt` characters in */
export function shiftExcerpt(excerpt: ToolExcerpt | undefined, outputAt: number): ToolExcerpt | undefined {
  return excerpt && { ...excerpt, textIndex: excerpt.textIndex + outputAt };
}
