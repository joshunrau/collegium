import type { RestartRequeue } from '@/activation/activation.types.ts';
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

/**
 * §7.3 — a unit an abandoned turn with effects left open: still assigned to the agent whose turn
 * worked it, or awaiting the verdict of the creator whose turn was judging its report (RC8)
 */
export type StrandedUnit = {
  readonly assigneeUsername: string;
  readonly channelId: string;
  readonly creatorUsername: string;
  readonly reference: string;
  readonly side: 'assignee' | 'creator';
};

export type BootReport = RestartRequeue & {
  readonly abandonedTurns: number;
  readonly downtime: Downtime | undefined;
  /** colleagues the abandoned turns had addressed and none of their turns has read since, each of those posts queued (§7.3) */
  readonly requeuedHandoffs: number;
  readonly strandedUnits: readonly StrandedUnit[];
};
