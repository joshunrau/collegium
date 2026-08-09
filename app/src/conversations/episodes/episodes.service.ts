import { Result } from '@collegium/core/utils';
import { Injectable } from '@nestjs/common';

import { InjectModel } from '@/prisma/prisma.decorators.ts';
import type { Model } from '@/prisma/prisma.types.ts';

import type { ConversationFailure } from '../conversations.types.ts';

@Injectable()
export class EpisodesService {
  constructor(
    @InjectModel('Episode') private readonly episodes: Model<'Episode'>,
    @InjectModel('Post') private readonly posts: Model<'Post'>
  ) {}

  /** removes one post from every agent's context (§8.4) — the row stays, as `/trace` provenance */
  async forget(postId: string): Promise<Result<void, ConversationFailure>> {
    const { count } = await this.posts.updateMany({ data: { isForgotten: true }, where: { id: postId } });
    if (count === 0) {
      return Result.err({ kind: 'post-not-found', postId });
    }
    return Result.ok();
  }

  async latestBoundaryPostId(agentUsername: string, channelId: string): Promise<string | undefined> {
    const latest = await this.episodes.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { postId: true },
      where: { agentUsername, channelId }
    });
    return latest?.postId;
  }

  /** a manual episode boundary (§3.8) — context never reaches back past the most recent one */
  async mark(agentUsername: string, channelId: string, postId: string): Promise<void> {
    await this.episodes.create({ data: { agentUsername, channelId, postId } });
  }
}
