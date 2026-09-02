export type MemoryWrite = {
  readonly agentUsername: string;
  readonly body: string;
  readonly description: string;
  /** provenance: the post the agent was reading when it decided to remember this (§3.6); null on a turn no post triggered */
  readonly originPostId: null | string;
};

/** one entry as it is listed: the reference the agent can read or prune it by, and the trigger it is shown against */
export type MemoryListing = {
  readonly description: string;
  readonly reference: string;
};

/** what a write reports back, so the eviction it caused can be disclosed beside it (§3.6) */
export type MemoryWriteReceipt<TEntry> = {
  readonly entry: TEntry;
  readonly evictedDescriptions: readonly string[];
  readonly reference: string;
};

export declare namespace MemoryFailure {
  /** no entry with that reference belongs to this agent */
  type NotFound = {
    kind: 'not-found';
    reference: string;
  };
  /** more than one of this agent's entries begins with that reference, so resolving it would be a guess */
  type Ambiguous = {
    kind: 'ambiguous';
    reference: string;
  };
  type Unresolved = Ambiguous | NotFound;
  /** over a cap, and therefore refused — never silently truncated (§3.6, A4) */
  type TooLong = {
    field: 'body' | 'description';
    kind: 'too-long';
    length: number;
    limit: number;
  };
  type Any = TooLong | Unresolved;
}

export type MemoryFailure = MemoryFailure.Any;
