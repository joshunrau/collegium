import { Injectable } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';

import { ConfigService } from '@/config/config.service.ts';

type BatchKey = {
  agentUsername: string;
  authorUsername: string;
  channelId: string;
};

type PendingBatch = {
  readonly addressedPostIds: string[];
  ceilingTimer: NodeJS.Timeout;
  channelId: string;
  readonly fragmentIds: string[];
  onMature: (batch: DebouncedBatch) => void;
  windowTimer: NodeJS.Timeout;
};

/**
 * §4.4 — what a batch absorbed besides the post that opened it: the posts that named the agent again,
 * which activation queues before the turn starts, and the fragments naming nobody, which are not
 * queued and reach the turn's trace alone.
 */
export type DebouncedBatch = {
  readonly addressedPostIds: readonly string[];
  readonly fragmentIds: readonly string[];
};

/**
 * §4.4 — people type in fragments seconds apart. A short window precedes turn start, resetting on
 * each further message from the same human in the same channel, under a hard ceiling so a human
 * typing steadily still gets a response. Folding a fragment here is free, which is the whole point:
 * past the window the running turn absorbs it instead, at the cost of a discarded completion.
 *
 * Debounce occurs strictly before a turn exists and creates nothing durable: it is not the queue.
 */
@Injectable()
export class DebounceService implements OnApplicationShutdown {
  private readonly ceilingMs: number;
  private readonly pending = new Map<string, PendingBatch>();
  private readonly windowMs: number;

  constructor(configService: ConfigService) {
    const { ceilingMs, windowMs } = configService.get('activation.debounce');
    this.ceilingMs = ceilingMs;
    this.windowMs = windowMs;
  }

  /** one input to the §4.2 idle predicate, which activation owns */
  isDebouncing(channelId: string): boolean {
    for (const batch of this.pending.values()) {
      if (batch.channelId === channelId) {
        return true;
      }
    }
    return false;
  }

  onApplicationShutdown(): void {
    for (const batch of this.pending.values()) {
      clearTimeout(batch.ceilingTimer);
      clearTimeout(batch.windowTimer);
    }
    this.pending.clear();
  }

  /** folds repeated posts into one maturation; the first call's continuation is the one that runs, told what the batch absorbed */
  schedule(key: BatchKey, postId: string, onMature: (batch: DebouncedBatch) => void): void {
    const id = this.toId(key);
    const existing = this.reset(id);
    if (existing) {
      existing.addressedPostIds.push(postId);
      return;
    }
    this.pending.set(id, {
      addressedPostIds: [],
      ceilingTimer: setTimeout(() => this.fire(id), this.ceilingMs),
      channelId: key.channelId,
      fragmentIds: [],
      onMature,
      windowTimer: setTimeout(() => this.fire(id), this.windowMs)
    });
  }

  /**
   * §4.4 folds on every further message from the same human, addressed or not — a fragment rarely
   * repeats the mention. Resets a pending batch's window and reports having done so; never creates
   * one, so an unaddressed post in a quiet channel stays inert. A fragment naming nobody is
   * remembered for the turn's trace; one naming a colleague only holds the window open.
   */
  touch(key: BatchKey, fragmentId?: string): boolean {
    const existing = this.reset(this.toId(key));
    if (existing && fragmentId !== undefined) {
      existing.fragmentIds.push(fragmentId);
    }
    return existing !== undefined;
  }

  private fire(id: string): void {
    const batch = this.pending.get(id);
    if (!batch) {
      return;
    }
    clearTimeout(batch.ceilingTimer);
    clearTimeout(batch.windowTimer);
    this.pending.delete(id);
    batch.onMature({ addressedPostIds: batch.addressedPostIds, fragmentIds: batch.fragmentIds });
  }

  private reset(id: string): PendingBatch | undefined {
    const existing = this.pending.get(id);
    if (!existing) {
      return undefined;
    }
    clearTimeout(existing.windowTimer);
    existing.windowTimer = setTimeout(() => this.fire(id), this.windowMs);
    return existing;
  }

  private toId(key: BatchKey): string {
    return `${key.agentUsername}\n${key.channelId}\n${key.authorUsername}`;
  }
}
