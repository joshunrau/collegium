// scripts/export-turns.js imports this file under Node's type stripping, which resolves no `@/`
// path: a runtime import added here breaks that script, and no test runs it.

import type { TurnStatus } from '@/prisma/prisma.types.ts';

export const WORKING_LINE = '⏳ _working…_';

/** §8.1 — the head while the turn waits on a person, up to the time the wait began and the closing underscore */
export const PARKED_LINE_STEMS = {
  approval: '🔐 _waiting on a decision since ',
  ask: '❓ _waiting on an answer since '
} as const;

/** §3.2 — deterministic code speaking as the agent: fixed strings and templated facts only */
export const OUTCOME_PHRASES: { readonly [K in Exclude<TurnStatus, 'running'>]: string } = {
  abandoned: '⚪ _abandoned — the process restarted mid-turn_',
  budget_exhausted: '⏸️ _stopped — action budget exhausted_',
  completed: '✅ _done_',
  context_exhausted: '⚠️ _stopped — ran out of context_',
  delivery_failure: '⚠️ _stopped — the chat server refused a post_',
  denied: '🛑 _stopped — action denied_',
  halted: '🛑 _stopped — global halt_',
  killed: '⏹️ _killed_',
  provider_outage: '⚠️ _stopped — the model provider failed_',
  provider_rejected: '⚠️ _stopped — the model provider rejected the request_',
  semantic_error: '⚠️ _stopped — internal error_',
  side_effect_ambiguous: '⚠️ _stopped — a call timed out with its effect unconfirmed_',
  stopped: '⏹️ _stopped_'
};
