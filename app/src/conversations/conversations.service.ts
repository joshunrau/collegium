import { Injectable } from '@nestjs/common';

import { InjectModel } from '@/prisma/prisma.decorators.ts';
import type { Model, ModelRow } from '@/prisma/prisma.types.ts';
import { isUniqueConstraintViolation } from '@/prisma/prisma.utils.ts';

import type { ActivationSource, DelegatingTurn, PostAuthorship, RecordablePost } from './conversations.types.ts';

@Injectable()
export class ConversationsService {
  constructor(@InjectModel('Post') private readonly posts: Model<'Post'>) {}

  /** which of the named posts the channel saw first, on Mattermost's clock; undefined when none is stored */
  async earliestOf(postIds: readonly string[]): Promise<string | undefined> {
    const earliest = await this.posts.findFirst({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
      where: { id: { in: [...postIds] } }
    });
    return earliest?.id;
  }

  /**
   * What a post's origin implies for §7.4 and §4.4: who authored it, its authoring turn's depth and
   * chain length, and the turn that authoring turn was answering — read off the store, never off the
   * text, so a return is recognized from the posts and cannot be claimed.
   */
  async findActivationSource(postId: string): Promise<ActivationSource | undefined> {
    const post = await this.posts.findUnique({
      include: { authoringTurn: { select: { chainLength: true, depth: true, triggeringPostId: true } } },
      where: { id: postId }
    });
    if (!post) {
      return undefined;
    }
    return {
      authorKind: post.authorKind,
      authorUsername: post.authorUsername,
      delegator: await this.findDelegator(post.authoringTurn?.triggeringPostId),
      parentChainLength: post.authoringTurn?.chainLength,
      parentDepth: post.authoringTurn?.depth
    };
  }

  /** the store's copy of a post the framework wrote, which is authoritative over the chat server's (§8.2) */
  async findAuthoredMessage(postId: string): Promise<string | undefined> {
    const post = await this.posts.findUnique({ select: { message: true }, where: { id: postId } });
    return post?.message;
  }

  /** the turn that authored this post — how /trace resolves a post id and scopes it to the turn's channel (§8.3) */
  async findAuthoringTurn(postId: string): Promise<ModelRow<'Turn'> | undefined> {
    const post = await this.posts.findUnique({ include: { authoringTurn: true }, where: { id: postId } });
    return post?.authoringTurn ?? undefined;
  }

  /** §3.7 — the words a human asked in, for the framework to quote back; an agent's or the system's are nobody's request */
  async findHumanRequest(postId: string): Promise<undefined | { message: string; username: string }> {
    const post = await this.posts.findUnique({
      select: { authorKind: true, authorUsername: true, message: true },
      where: { id: postId }
    });
    if (post?.authorKind !== 'human') {
      return undefined;
    }
    return { message: post.message, username: post.authorUsername };
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
  async record(post: RecordablePost, authorship?: PostAuthorship): Promise<boolean> {
    try {
      await this.posts.create({
        data: {
          // undefined leaves the column null, which is what a post carrying nothing should read as
          attachments: post.attachments.length === 0 ? undefined : { files: post.attachments },
          authoringTurnId: authorship?.turnId,
          authorKind: post.authorKind,
          authorUsername: post.authorUsername,
          channelId: post.channelId,
          createdAt: post.createdAt,
          id: post.id,
          kind: authorship?.kind ?? 'message',
          message: post.message
        }
      });
      return true;
    } catch (error) {
      if (!isUniqueConstraintViolation(error)) {
        throw error;
      }
      if (authorship !== undefined) {
        await this.posts.updateMany({
          data: { authoringTurnId: authorship.turnId, kind: authorship.kind },
          where: { authoringTurnId: null, id: post.id }
        });
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

  private async findDelegator(triggeringPostId: null | string | undefined): Promise<DelegatingTurn | undefined> {
    if (triggeringPostId === null || triggeringPostId === undefined) {
      return undefined;
    }
    const triggeringPost = await this.posts.findUnique({
      include: { authoringTurn: { select: { agentUsername: true, depth: true } } },
      where: { id: triggeringPostId }
    });
    return triggeringPost?.authoringTurn ?? undefined;
  }
}
