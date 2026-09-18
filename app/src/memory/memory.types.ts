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

/** the entry a revision replaces, and the provenance the entry replacing it carries (§3.6) */
export type MemoryRevision = {
  readonly agentUsername: string;
  readonly originPostId: null | string;
  readonly reference: string;
};

/** what a revision reports back: the entry it wrote, and the reference of the one it deleted (§3.6) */
export type MemoryRevisionReceipt<TEntry> = {
  readonly entry: TEntry;
  readonly reference: string;
  readonly revisionOf: string;
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
  /** the passage a replace names does not occur exactly once in the body, so substituting it would be a guess (§3.6) */
  type PassageUnmatched = {
    kind: 'passage-unmatched';
    occurrences: 'none' | 'several';
  };
  /** a revision that would leave nothing, which a write could never have stored; that is a delete */
  type EmptyBody = {
    kind: 'empty-body';
  };
  type Any = EmptyBody | PassageUnmatched | TooLong | Unresolved;
}

export type MemoryFailure = MemoryFailure.Any;
