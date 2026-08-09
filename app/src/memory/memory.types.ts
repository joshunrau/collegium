export type MemoryWrite = {
  readonly agentUsername: string;
  readonly body: string;
  readonly description: string;
  /** provenance: the post the agent was reading when it decided to remember this (§3.6) */
  readonly originPostId: string;
};

/** what a write reports back, so the eviction it caused can be disclosed beside it (§3.6) */
export type MemoryWriteReceipt<TEntry> = {
  readonly entry: TEntry;
  readonly evictedDescriptions: readonly string[];
};

export declare namespace MemoryFailure {
  /** no entry with that id belongs to this agent */
  type NotFound = {
    id: string;
    kind: 'not-found';
  };
  /** over a cap, and therefore refused — never silently truncated (§3.6, A4) */
  type TooLong = {
    field: 'body' | 'description';
    kind: 'too-long';
    length: number;
    limit: number;
  };
  type Any = NotFound | TooLong;
}

export type MemoryFailure = MemoryFailure.Any;
