import type { AgentProfile } from '@/agents/agents.types.ts';
import type { ChatTransport } from '@/chat/chat.transport.ts';

export type RunningAgent = {
  profile: AgentProfile;
  transport: ChatTransport;
};

/**
 * §7.3 — how far back the downtime reaches and how well it is known. `clean` came from a recorded
 * stop; `since-last-alive` came from the liveness stamp and is imprecise by at most its interval.
 */
export type Downtime =
  | { readonly kind: 'clean'; readonly startedAt: Date; readonly stoppedAt: Date }
  | { readonly kind: 'since-last-alive'; readonly lastAliveAt: Date; readonly startedAt: Date };

/** §7.3 — a unit left assigned to an agent whose turn on it the restart abandoned after it had acted */
export type StrandedUnit = {
  readonly assigneeUsername: string;
  readonly channelId: string;
  readonly creatorUsername: string;
  readonly reference: string;
};

export type BootReport = {
  readonly abandonedTurns: number;
  readonly downtime: Downtime | undefined;
  /** colleagues the abandoned turns had addressed and none of their turns has read since, queued at those posts (§7.3) */
  readonly requeuedHandoffs: number;
  /** abandoned turns that had not acted, their posts queued again (§7.3) */
  readonly requeuedTurns: number;
  readonly strandedUnits: readonly StrandedUnit[];
};
