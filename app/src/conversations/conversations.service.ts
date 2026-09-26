import { Injectable } from '@nestjs/common';
import { match } from 'ts-pattern';

import { InjectModel } from '@/prisma/prisma.decorators.ts';
import type { Model, ModelRow, TransactionClient } from '@/prisma/prisma.types.ts';
import { isUniqueConstraintViolation } from '@/prisma/prisma.utils.ts';

import { SPOKEN_POST_KINDS } from './conversations.utils.ts';

import type {
  ActivationSource,
  DelegatingTurn,
  EpisodeBoundary,
  PostAuthorship,
  RecordablePost,
  TurnRequest,
  TurnRequestOrigin
} from './conversations.types.ts';

@Injectable()
export class ConversationsService {
  constructor(@InjectModel('Post') private readonly posts: Model<'Post'>) {}

  /** §5.2 — who wrote each queued post and when, as a drain chooses among them; a post the store does not hold is left out */
  describeQueued(postIds: readonly string[]): Promise<Pick<ModelRow<'Post'>, 'authorKind' | 'createdAt' | 'id'>[]> {
    return this.posts.findMany({
      select: { authorKind: true, createdAt: true, id: true },
      where: { id: { in: [...postIds] } }
    });
  }

  /** §8.5 — every post older than the boundary, on Mattermost's clock; the boundary post itself stays */
  async eraseBefore(channelId: string, boundary: EpisodeBoundary, transaction: TransactionClient): Promise<void> {
    await transaction.post.deleteMany({ where: { channelId, createdAt: { lt: boundary.postsAfter } } });
  }

  /**
   * What a post's origin implies for §7.4 and §4.4: who authored it, its authoring turn's depth and
   * chain length, and the turn that authoring turn was answering — read off the store, never off the
   * text, so a return is recognized from the posts and cannot be claimed.
   */
  async findActivationSource(postId: string): Promise<ActivationSource | undefined> {
    const post = await this.posts.findUnique({
      include: {
        authoringTurn: { select: { chainLength: true, depth: true, rootPostId: true, triggeringPostId: true } }
      },
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
      parentDepth: post.authoringTurn?.depth,
      parentRootPostId: post.authoringTurn?.rootPostId ?? undefined
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

  /**
   * §3.7 — who asked: a person's words are quoted back, a colleague is named beside the person or
   * trigger its own turn's chain descends from (§7.4), the system bot's post is a trigger.
   */
  async findRequester(postId: string): Promise<TurnRequest | undefined> {
    const post = await this.posts.findUnique({
      select: {
        authoringTurn: { select: { rootPostId: true } },
        authorKind: true,
        authorUsername: true,
        message: true
      },
      where: { id: postId }
    });
    if (!post) {
      return undefined;
    }
    return match(post)
      .with({ authorKind: 'agent' }, async ({ authoringTurn, authorUsername }): Promise<TurnRequest> => ({
        kind: 'agent',
        onBehalfOf: await this.findRequestOrigin(authoringTurn?.rootPostId),
        username: authorUsername
      }))
      .with({ authorKind: 'human' }, ({ authorUsername, message }): TurnRequest => ({
        kind: 'human',
        message,
        username: authorUsername
      }))
      .with({ authorKind: 'system' }, (): TurnRequest => ({ kind: 'system' }))
      .exhaustive();
  }

  /** one post by id, of any kind, as agent context may show it: absent once forgotten (§8.4) or where the store never took it */
  async findUnforgotten(
    postId: string
  ): Promise<
    | Pick<ModelRow<'Post'>, 'authorKind' | 'authorUsername' | 'createdAt' | 'id' | 'kind' | 'message' | 'observedAt'>
    | undefined
  > {
    const post = await this.posts.findFirst({
      select: {
        authorKind: true,
        authorUsername: true,
        createdAt: true,
        id: true,
        kind: true,
        message: true,
        observedAt: true
      },
      where: { id: postId, isForgotten: false }
    });
    return post ?? undefined;
  }

  async latestPostIdIn(channelId: string): Promise<string | undefined> {
    const latest = await this.posts.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { id: true },
      where: { channelId }
    });
    return latest?.id;
  }

  /** §8.5 — which of these posts of the channel a clear at the boundary erases, read before it does */
  async listErasedAmong(
    postIds: readonly string[],
    channelId: string,
    boundary: EpisodeBoundary,
    transaction: TransactionClient
  ): Promise<string[]> {
    if (postIds.length === 0) {
      return [];
    }
    const erased = await transaction.post.findMany({
      select: { id: true },
      where: { channelId, createdAt: { lt: boundary.postsAfter }, id: { in: [...postIds] } }
    });
    return erased.map((post) => post.id);
  }

  /** what one turn said, earliest first: the posts that may address a colleague, never its status post or prompts (§7.3) */
  listSpokenBy(turnId: string): Promise<Pick<ModelRow<'Post'>, 'id' | 'message' | 'observedAt'>[]> {
    return this.posts.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, message: true, observedAt: true },
      where: { authoringTurnId: turnId, kind: { in: [...SPOKEN_POST_KINDS] } }
    });
  }

  /**
   * Idempotent on post id — backfill and the live stream overlap, and ingestion fans out once per
   * agent socket. Reports whether this call inserted the row: the winner owns the once-per-post
   * effects (§4.5), and the row itself is the claim. A losing call still stamps `authoringTurnId`,
   * since a peer's socket can observe a post before the turn that authored it records it.
   */
  async record(post: RecordablePost, authorship?: PostAuthorship, transaction?: TransactionClient): Promise<boolean> {
    const posts = transaction?.post ?? this.posts;
    try {
      await posts.create({
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
        await posts.updateMany({
          data: { authoringTurnId: authorship.turnId, kind: authorship.kind },
          where: { authoringTurnId: null, id: post.id }
        });
      }
      return false;
    }
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

  /** §7.4 — the chain's root is a person's or the system bot's post by construction; an agent's, left by a restart, names nobody */
  private async findRequestOrigin(rootPostId: null | string | undefined): Promise<TurnRequestOrigin | undefined> {
    if (rootPostId === null || rootPostId === undefined) {
      return undefined;
    }
    const root = await this.posts.findUnique({
      select: { authorKind: true, authorUsername: true, message: true },
      where: { id: rootPostId }
    });
    return match(root)
      .with(null, { authorKind: 'agent' }, () => undefined)
      .with({ authorKind: 'human' }, ({ authorUsername, message }): TurnRequestOrigin => ({
        kind: 'human',
        message,
        username: authorUsername
      }))
      .with({ authorKind: 'system' }, (): TurnRequestOrigin => ({ kind: 'system' }))
      .exhaustive();
  }
}
