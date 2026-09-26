import { Injectable } from '@nestjs/common';

import { InjectModel } from '@/prisma/prisma.decorators.ts';
import type { Model, TransactionClient } from '@/prisma/prisma.types.ts';
import { isUniqueConstraintViolation } from '@/prisma/prisma.utils.ts';

import { selectTakable } from './queue.utils.ts';

import type { QueueEntry, QueueLane } from './queue.utils.ts';

/**
 * §5.2 — the queue holds posts, never content: one row per post queued for an agent in a channel.
 * Content arrives through the channel window, which is why deleting the queue rebuilds from posts
 * and why it does not violate A1. A turn stamps the rows it takes; its exit either consumes them or
 * returns them to the queue, never "releases" them, which stays the deferred hand-off's word.
 */
@Injectable()
export class QueueService {
  constructor(@InjectModel('QueueEntry') private readonly entries: Model<'QueueEntry'>) {}

  /** §5.2 — an exit that allows progress: the turn answered every post it took (§7.1) */
  async consume(turnId: string): Promise<void> {
    await this.entries.deleteMany({ where: { takenByTurnId: turnId } });
  }

  /** §8.4, §8.5 — a forgotten or erased post is not to be acted on, whether a turn took it or not */
  async deletePosts(postIds: readonly string[], transaction?: TransactionClient): Promise<void> {
    if (postIds.length === 0) {
      return;
    }
    await (transaction?.queueEntry ?? this.entries).deleteMany({ where: { postId: { in: [...postIds] } } });
  }

  /**
   * §8.4 — what waits in the lane thrown away rather than answered, for work a configuration change
   * made stale. The posts stay where they are, so the channel still reads as it did; a running turn
   * keeps what it took. Returns how many posts were discarded.
   */
  async discard(lane: QueueLane): Promise<number> {
    const { count } = await this.entries.deleteMany({ where: { ...lane, takenByTurnId: null } });
    return count;
  }

  /**
   * §5.2 — a repeat insert is ignored, so a post waits in a lane at most once, taken or not;
   * `returnedOnce` marks a post a restart queued after a turn that may have crashed the process (§7.3)
   */
  async insert(
    lane: QueueLane,
    postId: string,
    { returnedOnce = false }: { returnedOnce?: boolean } = {}
  ): Promise<void> {
    try {
      await this.entries.create({ data: { ...lane, enqueuedAt: new Date(), postId, returnedOnce } });
    } catch (error) {
      if (!isUniqueConstraintViolation(error)) {
        throw error;
      }
    }
  }

  /** §8.5 — the posts queued in a channel, taken or not, which a clear checks against what it erases */
  async listPostIdsIn(channelId: string, transaction: TransactionClient): Promise<string[]> {
    const entries = await transaction.queueEntry.findMany({ select: { postId: true }, where: { channelId } });
    return entries.map((entry) => entry.postId);
  }

  /** every untaken row, oldest first — what the boot and /resume sweep and the stall sweep walk (§7.3, §7.6) */
  listStanding(): Promise<QueueEntry[]> {
    return this.entries.findMany({ orderBy: [{ enqueuedAt: 'asc' }, { id: 'asc' }], where: { takenByTurnId: null } });
  }

  /** the lane's untaken rows, oldest first: what waits behind any turn holding it (§8.4) */
  listUntaken(lane: QueueLane): Promise<QueueEntry[]> {
    return this.entries.findMany({
      orderBy: [{ enqueuedAt: 'asc' }, { id: 'asc' }],
      where: { ...lane, takenByTurnId: null }
    });
  }

  /** §7.1 — an exit that does not allow progress: every row the turn took stands again. Returns their posts */
  async returnTaken(turnId: string): Promise<string[]> {
    const taken = await this.entries.findMany({ select: { postId: true }, where: { takenByTurnId: turnId } });
    await this.entries.updateMany({ data: { takenByTurnId: null }, where: { takenByTurnId: turnId } });
    return taken.map((entry) => entry.postId);
  }

  /**
   * §7.3 — what an abandoned turn took, after an unclean stop that turn may have caused: a row
   * returned once already is deleted rather than returned again, so a post whose turn takes the
   * process down is not re-run at every boot; the rest stand again, marked. Returns both.
   */
  async returnTakenOnce(turnId: string): Promise<{ readonly dropped: string[]; readonly returned: string[] }> {
    const taken = await this.entries.findMany({ where: { takenByTurnId: turnId } });
    const dropped = taken.filter((entry) => entry.returnedOnce);
    await this.entries.deleteMany({ where: { id: { in: dropped.map((entry) => entry.id) } } });
    await this.entries.updateMany({
      data: { returnedOnce: true, takenByTurnId: null },
      where: { returnedOnce: false, takenByTurnId: turnId }
    });
    return {
      dropped: dropped.map((entry) => entry.postId),
      returned: taken.filter((entry) => !entry.returnedOnce).map((entry) => entry.postId)
    };
  }

  /**
   * §5.2 — stamps with the turn every untaken row of the lane queued at or before the bound, and
   * returns their posts, oldest first. What was queued after it waits for the next turn.
   */
  async take(turnId: string, lane: QueueLane, enqueuedBefore: Date): Promise<string[]> {
    const takable = selectTakable(await this.listUntaken(lane), enqueuedBefore);
    if (takable.length === 0) {
      return [];
    }
    await this.entries.updateMany({
      data: { takenByTurnId: turnId },
      where: { id: { in: takable.map((entry) => entry.id) }, takenByTurnId: null }
    });
    return takable.map((entry) => entry.postId);
  }
}
