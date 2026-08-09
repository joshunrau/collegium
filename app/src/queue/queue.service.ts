import { Injectable } from '@nestjs/common';

import { InjectModel } from '@/prisma/prisma.decorators.ts';
import type { Model, ModelRow } from '@/prisma/prisma.types.ts';
import { isUniqueConstraintViolation } from '@/prisma/prisma.utils.ts';

export type QueueEntry = ModelRow<'QueueEntry'>;

/**
 * §5.2 — the queue holds pointers, never content: one row per (agent, channel) saying unprocessed
 * work exists and where it starts. Content arrives through the channel window, which is why
 * deleting the queue rebuilds from posts and why it does not violate A1.
 */
@Injectable()
export class QueueService {
  constructor(@InjectModel('QueueEntry') private readonly entries: Model<'QueueEntry'>) {}

  /** drain, not pop — the whole backlog becomes one turn (§5.2) */
  async drain(agentUsername: string, channelId: string): Promise<QueueEntry | undefined> {
    const entry = await this.find(agentUsername, channelId);
    if (!entry) {
      return undefined;
    }
    await this.entries.delete({ where: { id: entry.id } });
    return entry;
  }

  /** keeps the earliest unprocessed post id — a later fragment never advances the pointer */
  async enqueue(agentUsername: string, channelId: string, postId: string): Promise<void> {
    try {
      await this.entries.create({ data: { agentUsername, channelId, earliestUnprocessedPostId: postId } });
    } catch (error) {
      if (!isUniqueConstraintViolation(error)) {
        throw error;
      }
    }
  }

  /** every standing entry — what the boot and /resume sweep walks (§7.3, §7.4) */
  listAll(): Promise<QueueEntry[]> {
    return this.entries.findMany({});
  }

  async peek(agentUsername: string, channelId: string): Promise<QueueEntry | undefined> {
    return this.find(agentUsername, channelId);
  }

  private async find(agentUsername: string, channelId: string): Promise<QueueEntry | undefined> {
    const entry = await this.entries.findUnique({
      where: { agentUsername_channelId: { agentUsername, channelId } }
    });
    return entry ?? undefined;
  }
}
