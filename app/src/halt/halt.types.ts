export type HaltFailure = { channelId: string; kind: 'violation-standing' } | { kind: 'not-halted' };

export type HaltReason =
  | { agentUsernames: readonly string[]; channelId: string; kind: 'topology-violation' }
  | { ceiling: number; kind: 'turn-ceiling' };
