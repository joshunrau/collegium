type PendingEntry<TDecision> = {
  readonly channelId: string;
  readonly id: string;
  readonly resolve: (decision: TDecision) => void;
};

/**
 * Maps a pending row's id → the promise resolver a blocked turn is waiting on, in memory. The DB
 * row is the durable record; a restart loses resolvers, which is correct — `invalidateAll` runs on
 * boot and edits every stale prompt to a dead state (§7.3).
 */
export class PendingRegistry<TDecision> {
  private readonly entries = new Map<string, PendingEntry<TDecision>>();

  register(entry: PendingEntry<TDecision>): void {
    this.entries.set(entry.id, entry);
  }

  /** removes and returns the resolver — a resolution happens exactly once */
  take(id: string): PendingEntry<TDecision> | undefined {
    const entry = this.entries.get(id);
    this.entries.delete(id);
    return entry;
  }
}
