import { Injectable } from '@nestjs/common';

import { InjectModel } from '@/prisma/prisma.decorators.ts';
import type { Model, ModelRow } from '@/prisma/prisma.types.ts';

export type QueueEntry = ModelRow<'QueueEntry'>;

/**
 * §5.2 — the queue holds pointers, never content: one row per (agent, channel) saying unprocessed
 * work exists and where it starts. Content arrives through the channel window, which is why
 * deleting the queue rebuilds from posts and why it does not violate A1. Every write stamps
 * `lastEnqueuedAt`, which is how a consume learns the row changed after it was read.
 */
@Injectable()
export class QueueService {
  constructor(@InjectModel('QueueEntry') private readonly entries: Model<'QueueEntry'>) {}

  /**
   * §5.2 — deletes the entry a finished turn read, but only if it still stands exactly as read: an
   * enqueue or a pointer move since has stamped it again and keeps it standing. Returns whether it
   * deleted.
   */
  async consumeIfUnchanged(entry: QueueEntry): Promise<boolean> {
    const deleted = await this.entries.deleteMany({
      where: {
        earliestUnprocessedPostId: entry.earliestUnprocessedPostId,
        id: entry.id,
        lastEnqueuedAt: entry.lastEnqueuedAt
      }
    });
    return deleted.count > 0;
  }

  /**
   * §8.4 — the standing entry thrown away rather than consumed, for work a configuration change
   * made stale. The posts stay where they are; only the pointer saying they are unprocessed goes,
   * so nothing runs them and the channel still reads as it did.
   */
  discard(agentUsername: string, channelId: string): Promise<QueueEntry | undefined> {
    return this.take(agentUsername, channelId);
  }

  /** drain, not pop — the whole backlog becomes one turn (§5.2) */
  drain(agentUsername: string, channelId: string): Promise<QueueEntry | undefined> {
    return this.take(agentUsername, channelId);
  }

  /** keeps the earliest unprocessed post id — a later fragment never advances the pointer, only the stamp */
  async enqueue(agentUsername: string, channelId: string, postId: string): Promise<void> {
    const now = new Date();
    await this.entries.upsert({
      create: { agentUsername, channelId, earliestUnprocessedPostId: postId, lastEnqueuedAt: now },
      update: { lastEnqueuedAt: now },
      where: { agentUsername_channelId: { agentUsername, channelId } }
    });
  }

  /** every standing entry — what the boot and /resume sweep walks (§7.3, §7.4) */
  listAll(): Promise<QueueEntry[]> {
    return this.entries.findMany({});
  }

  async peek(agentUsername: string, channelId: string): Promise<QueueEntry | undefined> {
    return this.find(agentUsername, channelId);
  }

  /** moves a standing pointer; the caller has established the post is earlier than the one it names now (§7.1) */
  async pointAt(agentUsername: string, channelId: string, postId: string): Promise<void> {
    await this.entries.updateMany({
      data: { earliestUnprocessedPostId: postId, lastEnqueuedAt: new Date() },
      where: { agentUsername, channelId }
    });
  }

  private async find(agentUsername: string, channelId: string): Promise<QueueEntry | undefined> {
    const entry = await this.entries.findUnique({
      where: { agentUsername_channelId: { agentUsername, channelId } }
    });
    return entry ?? undefined;
  }

  /** reading and deleting the pointer in one step — what both a drain and a discard do to the row */
  private async take(agentUsername: string, channelId: string): Promise<QueueEntry | undefined> {
    const entry = await this.find(agentUsername, channelId);
    if (!entry) {
      return undefined;
    }
    await this.entries.delete({ where: { id: entry.id } });
    return entry;
  }
}
