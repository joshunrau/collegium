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

/** §3.6 — one entry as an operator's listing shows it: how often and how lately it was revised in place */
export type MemoryListingWithRevisions = MemoryListing & {
  readonly revisedAt: Date | null;
  readonly revision: number;
};

/** what a write reports back, so the eviction it caused can be disclosed beside it (§3.6) */
export type MemoryWriteReceipt<TEntry> = {
  readonly entry: TEntry;
  readonly evictedDescriptions: readonly string[];
  readonly reference: string;
};

/** the entry a revision edits, the provenance it carries once revised, and the description it takes on if it names one (§3.6) */
export type MemoryRevision = {
  readonly agentUsername: string;
  readonly description?: string;
  readonly originPostId: null | string;
  readonly reference: string;
};

/** one passage a replace substitutes (§3.6) */
export type MemoryEdit = {
  readonly passage: string;
  readonly replacement: string;
};

/** what a revision reports back: the entry as revised and as it stood before, under the reference it has always had (§3.6) */
export type MemoryRevisionReceipt<TEntry> = {
  readonly entry: TEntry;
  readonly previous: TEntry;
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
  /** what a write sends is over a cap, and therefore refused — never silently truncated (§3.6, A4) */
  type TooLong = {
    field: 'body' | 'description';
    kind: 'too-long';
    length: number;
    limit: number;
  };
  /**
   * §3.6 — a revision over a cap: the description it names, or the body it would leave, beside what
   * the entry holds now, since the remedy is room made in that entry rather than another one
   */
  type RevisionTooLong =
    | {
        field: 'body';
        kind: 'revision-too-long';
        length: number;
        limit: number;
        reference: string;
        storedLength: number;
      }
    | {
        field: 'description';
        kind: 'revision-too-long';
        length: number;
        limit: number;
      };
  /**
   * The passage a replace names does not occur exactly once in the body, so substituting it would be
   * a guess (§3.6). `edit` is its 1-based place among several edits, none of which is then applied.
   */
  type PassageUnmatched = {
    edit?: number;
    kind: 'passage-unmatched';
    occurrences: 'none' | 'several';
  };
  /** a revision that would leave nothing, which a write could never have stored; that is a delete */
  type EmptyBody = {
    kind: 'empty-body';
  };
  /** §3.6 — the turn has not seen the entry's stored revision: it never has, or it saw an earlier one */
  type UnseenRevision = {
    kind: 'unseen-revision';
    lastSeen: 'earlier' | 'never';
    reference: string;
  };
  type Any = EmptyBody | PassageUnmatched | RevisionTooLong | TooLong | Unresolved | UnseenRevision;
}

export type MemoryFailure = MemoryFailure.Any;
