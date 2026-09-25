// scripts/export-turns.js reaches this file through turns/status/status-post.constants.ts under
// Node's type stripping, which resolves no `@/` path: a runtime import added here breaks that script.

import type { PendingDecision } from './decisions/decisions.types.ts';

/** §8.1 — the glyph a decision leads with wherever it appears: its prompt, the parked status post, and the listings (§8.4) */
export const DECISION_GLYPHS = {
  approval: '🔐',
  ask: '❓'
} as const satisfies { readonly [Kind in PendingDecision['kind']]: string };

/** §5.3 — the framework action a budget extension asks a person to approve, named where it is requested and where a parked turn is reported (§8.4) */
export const EXTEND_BUDGET_ACTION = 'extend_budget';
