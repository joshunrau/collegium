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

export type BootReport = {
  readonly abandonedTurns: number;
  readonly downtime: Downtime | undefined;
};
