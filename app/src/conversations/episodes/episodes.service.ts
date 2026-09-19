import { Result } from '@collegium/core/utils';
import { Injectable } from '@nestjs/common';

import { InjectModel } from '@/prisma/prisma.decorators.ts';
import type { Model, TransactionClient } from '@/prisma/prisma.types.ts';

import type { ConversationFailure, EpisodeBoundary } from '../conversations.types.ts';

@Injectable()
export class EpisodesService {
  constructor(
    @InjectModel('Episode') private readonly episodes: Model<'Episode'>,
    @InjectModel('Post') private readonly posts: Model<'Post'>
  ) {}

  /** §8.5 — every boundary set before the clear; each names a post the clear removes, so it bounds nothing */
  async eraseBefore(channelId: string, boundary: EpisodeBoundary, transaction: TransactionClient): Promise<void> {
    await transaction.episode.deleteMany({ where: { channelId, createdAt: { lt: boundary.eventsAfter } } });
  }

  /** removes one post from every agent's context (§8.4) — the row stays, as `/trace` provenance */
  async forget(postId: string): Promise<Result<void, ConversationFailure>> {
    const { count } = await this.posts.updateMany({ data: { isForgotten: true }, where: { id: postId } });
    if (count === 0) {
      return Result.err({ kind: 'post-not-found', postId });
    }
    return Result.ok();
  }

  /**
   * Where the agent's context in this channel begins (§3.8), each side cut on its own clock:
   * posts on Mattermost's, events on this host's. A boundary whose post is no longer stored
   * bounds nothing.
   */
  async latestBoundary(agentUsername: string, channelId: string): Promise<EpisodeBoundary | undefined> {
    const latest = await this.episodes.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { postId: true },
      where: { agentUsername, channelId }
    });
    if (latest === null) {
      return undefined;
    }
    const boundaryPost = await this.posts.findFirst({
      select: { createdAt: true, observedAt: true },
      where: { id: latest.postId }
    });
    if (!boundaryPost) {
      return undefined;
    }
    return { eventsAfter: boundaryPost.observedAt, postsAfter: boundaryPost.createdAt };
  }

  /** a manual episode boundary (§3.8) — context never reaches back past the most recent one */
  async mark(agentUsername: string, channelId: string, postId: string): Promise<void> {
    await this.episodes.create({ data: { agentUsername, channelId, postId } });
  }
}
