import type { ChannelKind } from '@/chat/chat.types.ts';

/** a channel lock someone holds now, and since when (§5.1) */
export type HeldLock = {
  readonly acquiredAt: Date;
  readonly agentUsername: string;
  readonly channelId: string;
};

export type LockHandle = {
  release(): void;
};

/** what the roster holds per channel: what it is, what it is called, and everyone in it (§3.11) */
export type ChannelRecord = {
  readonly displayName: string;
  readonly kind: ChannelKind;
  readonly memberUsernames: Set<string>;
};

/** a channel a search may surface posts of, named as the model should see it (§3.8) */
export type ReachableChannel = {
  readonly channelId: string;
  readonly name: string;
};

/** a respond-to-all channel holding more than one agent (§3.10) */
export type TopologyViolation = {
  readonly agentUsernames: readonly string[];
  readonly channelId: string;
};
