import type { BeforeApplicationShutdown } from '@nestjs/common';

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
export class PendingRegistry<TDecision> implements BeforeApplicationShutdown {
  private readonly entries = new Map<string, PendingEntry<TDecision>>();
  private readonly postings = new Set<Promise<unknown>>();

  /** runs before the store disconnects, so a prompt caught mid-posting still has its post recorded */
  async beforeApplicationShutdown(): Promise<void> {
    await Promise.allSettled(this.postings);
  }

  /**
   * §7.3 — a prompt posted but not yet recorded is one boot cannot find to invalidate, so a clean
   * stop waits for the posting and the write of its post id to finish
   */
  async completeBeforeShutdown<TValue>(posting: () => Promise<TValue>): Promise<TValue> {
    const running = posting();
    this.postings.add(running);
    try {
      return await running;
    } finally {
      this.postings.delete(running);
    }
  }

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
