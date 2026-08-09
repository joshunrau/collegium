import { Injectable } from '@nestjs/common';

import { InjectModel } from '@/prisma/prisma.decorators.ts';
import type { Model } from '@/prisma/prisma.types.ts';
import { isUniqueConstraintViolation } from '@/prisma/prisma.utils.ts';

import type { ActivationSource, RecordablePost } from './conversations.types.ts';

@Injectable()
export class ConversationsService {
  constructor(@InjectModel('Post') private readonly posts: Model<'Post'>) {}

  /** what a post's origin implies for §7.4 depth and §4.4 folding: who authored it, and its authoring turn's depth */
  async findActivationSource(postId: string): Promise<ActivationSource | undefined> {
    const post = await this.posts.findUnique({
      include: { authoringTurn: { select: { depth: true } } },
      where: { id: postId }
    });
    if (!post) {
      return undefined;
    }
    return {
      authorKind: post.authorKind,
      authorUsername: post.authorUsername,
      parentDepth: post.authoringTurn?.depth
    };
  }

  /** which turn authored this post, and where — how /trace resolves a post id and scopes it (§8.3) */
  async findAuthoringTurn(postId: string): Promise<undefined | { channelId: string; turnId: string }> {
    const post = await this.posts.findUnique({
      select: { authoringTurnId: true, channelId: true },
      where: { id: postId }
    });
    if (!post?.authoringTurnId) {
      return undefined;
    }
    return { channelId: post.channelId, turnId: post.authoringTurnId };
  }

  /** when the store last saw the world — the start of the downtime window a boot notice states (§7.3) */
  async latestObservedAt(): Promise<Date | undefined> {
    const latest = await this.posts.findFirst({ orderBy: { observedAt: 'desc' }, select: { observedAt: true } });
    return latest?.observedAt;
  }

  async latestPostIdIn(channelId: string): Promise<string | undefined> {
    const latest = await this.posts.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { id: true },
      where: { channelId }
    });
    return latest?.id;
  }

  /**
   * Idempotent on post id — backfill and the live stream overlap, and ingestion fans out once per
   * agent socket. Reports whether this call inserted the row: the winner owns the once-per-post
   * effects (§4.5), and the row itself is the claim. A losing call still stamps `authoringTurnId`,
   * since a peer's socket can observe a post before the turn that authored it records it.
   */
  async record(post: RecordablePost, authoringTurnId?: string): Promise<boolean> {
    try {
      await this.posts.create({
        data: {
          authoringTurnId,
          authorKind: post.authorKind,
          authorUsername: post.authorUsername,
          channelId: post.channelId,
          createdAt: post.createdAt,
          id: post.id,
          message: post.message
        }
      });
      return true;
    } catch (error) {
      if (!isUniqueConstraintViolation(error)) {
        throw error;
      }
      if (authoringTurnId !== undefined) {
        await this.posts.updateMany({ data: { authoringTurnId }, where: { authoringTurnId: null, id: post.id } });
      }
      return false;
    }
  }

  /** what /queue reports: how far behind the pointer post the channel has moved (§8.4) */
  async summarizeBacklog(
    channelId: string,
    postId: string
  ): Promise<undefined | { message: string; pendingCount: number }> {
    const pointer = await this.posts.findUnique({ where: { id: postId } });
    if (!pointer) {
      return undefined;
    }
    const pendingCount = await this.posts.count({
      where: { channelId, createdAt: { gte: pointer.createdAt }, isForgotten: false }
    });
    return { message: pointer.message, pendingCount };
  }

  /** keeps the stored copy of a framework-authored post current as it is edited in place (§8.1) */
  async updateAuthoredMessage(postId: string, message: string): Promise<void> {
    await this.posts.updateMany({ data: { message }, where: { id: postId } });
  }
}
