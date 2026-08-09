import type { Result } from '@collegium/core/utils';

import type { ModelRow, TriggerSource } from '@/prisma/prisma.types.ts';

export type Trigger = ModelRow<'Trigger'>;

export type TriggerInput = {
  /** a stable key for an adapter that can re-observe the same event — a duplicate makes record a no-op (§4.2) */
  readonly dedupeKey?: string;
  readonly reference: PrismaJson.TriggerReference;
  readonly source: TriggerSource;
  readonly targetAgentUsername: string;
  readonly targetChannelId: string;
};

/**
 * What a source must finish before its trigger may be marked handled — marking mail read, for
 * one. Registered by the owning module, so triggers never depends on mail. A failure leaves the
 * trigger outstanding: an item is handled in the world, or it is not handled at all.
 */
export type TriggerResolutionHook = (trigger: Trigger) => Promise<Result<void, { message: string }>>;

export declare namespace TriggerFailure {
  /** §4.2 — the agent's socket never sees a channel it is not in, so delivery has no route there */
  type AgentAbsent = {
    agentUsername: string;
    channelId: string;
    kind: 'agent-absent';
  };
  /** the channel's type could not be established, so intake refuses rather than guesses (A4) */
  type ChannelUnreachable = {
    channelId: string;
    kind: 'channel-unreachable';
    message: string;
  };
  /** §4.2 — the system bot has no route into a DM, so a DM-targeted trigger is refused loudly */
  type DirectMessageTarget = {
    channelId: string;
    kind: 'dm-target';
  };
  type NotFound = {
    kind: 'not-found';
    triggerId: string;
  };
  /** the source's own handling failed, so the trigger stays outstanding rather than looking done */
  type NotResolvable = {
    kind: 'not-resolvable';
    message: string;
    triggerId: string;
  };
  /** another flush claimed it first — one post per trigger, ever (§4.2) */
  type NotPending = {
    kind: 'not-pending';
    triggerId: string;
  };
  type UnknownAgent = {
    agentUsername: string;
    kind: 'unknown-agent';
  };
  type Any =
    AgentAbsent | ChannelUnreachable | DirectMessageTarget | NotFound | NotPending | NotResolvable | UnknownAgent;
}

export type TriggerFailure = TriggerFailure.Any;
