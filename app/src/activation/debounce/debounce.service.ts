import { Injectable } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';

import { ConfigService } from '@/config/config.service.ts';

type BatchKey = {
  agentUsername: string;
  authorUsername: string;
  channelId: string;
};

type PendingBatch = {
  ceilingTimer: NodeJS.Timeout;
  channelId: string;
  onMature: () => void;
  windowTimer: NodeJS.Timeout;
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
    const { ceilingMs, windowMs } = configService.get('app.debounce');
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

  /** folds repeated posts into one maturation; the first call's continuation is the one that runs */
  schedule(key: BatchKey, onMature: () => void): void {
    const id = this.toId(key);
    if (this.reset(id)) {
      return;
    }
    this.pending.set(id, {
      ceilingTimer: setTimeout(() => this.fire(id), this.ceilingMs),
      channelId: key.channelId,
      onMature,
      windowTimer: setTimeout(() => this.fire(id), this.windowMs)
    });
  }

  /**
   * §4.4 folds on every further message from the same human, addressed or not — a fragment rarely
   * repeats the mention. Resets a pending batch's window and reports having done so; never creates
   * one, so an unaddressed post in a quiet channel stays inert.
   */
  touch(key: BatchKey): boolean {
    return this.reset(this.toId(key));
  }

  private fire(id: string): void {
    const batch = this.pending.get(id);
    if (!batch) {
      return;
    }
    clearTimeout(batch.ceilingTimer);
    clearTimeout(batch.windowTimer);
    this.pending.delete(id);
    batch.onMature();
  }

  private reset(id: string): boolean {
    const existing = this.pending.get(id);
    if (!existing) {
      return false;
    }
    clearTimeout(existing.windowTimer);
    existing.windowTimer = setTimeout(() => this.fire(id), this.windowMs);
    return true;
  }

  private toId(key: BatchKey): string {
    return `${key.agentUsername}\n${key.channelId}\n${key.authorUsername}`;
  }
}
