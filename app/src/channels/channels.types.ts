export type LockHandle = {
  release(): void;
};

/** a respond-to-all channel holding more than one agent (§3.10) */
export type TopologyViolation = {
  readonly agentUsernames: readonly string[];
  readonly channelId: string;
};
