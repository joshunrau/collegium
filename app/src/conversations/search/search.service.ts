import { Injectable } from '@nestjs/common';

import type { ReachableChannel } from '@/channels/channels.types.ts';
import { InjectModel } from '@/prisma/prisma.decorators.ts';
import type { Model, ModelRow, PostKind } from '@/prisma/prisma.types.ts';

import { EpisodesService } from '../episodes/episodes.service.ts';

import type { SearchHit, SearchInput, SearchPostInput } from '../conversations.types.ts';

const READABLE_KINDS = { notIn: ['notice', 'status'] } satisfies { notIn: PostKind[] };

/**
 * §3.8 — a read over the post store bounded exactly as the window is, per channel: behind each
 * channel's own episode boundary, never a forgotten post, and never a status post or a notice —
 * the one is the trace rendered, the other the framework speaking under the agent's name.
 */
@Injectable()
export class SearchService {
  constructor(
    private readonly episodesService: EpisodesService,
    @InjectModel('Post') private readonly posts: Model<'Post'>
  ) {}

  async find(input: SearchInput): Promise<SearchHit[]> {
    if (input.channels.length === 0) {
      return [];
    }
    const rows = await this.posts.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: input.limit,
      where: {
        ...(await this.reachableWhere(input.agentUsername, input.channels)),
        message: { contains: input.query },
        ...(input.excludePostIds !== undefined && { id: { notIn: [...input.excludePostIds] } }),
        ...(input.authorUsername !== undefined && { authorUsername: input.authorUsername }),
        ...((input.from ?? input.until) && { createdAt: { gte: input.from, lte: input.until } })
      }
    });
    return rows.map((row) => this.toHit(row, input.channels));
  }

  /** §3.8 — the same read as `find` narrowed to one id, so a post out of reach is simply not found */
  async findById(input: SearchPostInput): Promise<SearchHit | undefined> {
    if (input.channels.length === 0) {
      return undefined;
    }
    const row = await this.posts.findFirst({
      where: { ...(await this.reachableWhere(input.agentUsername, input.channels)), id: input.postId }
    });
    return row === null ? undefined : this.toHit(row, input.channels);
  }

  private async reachableWhere(agentUsername: string, channels: readonly ReachableChannel[]) {
    const perChannel = await Promise.all(
      channels.map(async ({ channelId }) => {
        const boundary = await this.episodesService.latestBoundary(agentUsername, channelId);
        return { channelId, ...(boundary && { createdAt: { gt: boundary.postsAfter } }) };
      })
    );
    return { isForgotten: false, kind: READABLE_KINDS, OR: perChannel };
  }

  private toHit(row: ModelRow<'Post'>, channels: readonly ReachableChannel[]): SearchHit {
    return {
      authorUsername: row.authorUsername,
      channelName: channels.find((channel) => channel.channelId === row.channelId)?.name ?? row.channelId,
      createdAt: row.createdAt,
      id: row.id,
      message: row.message
    };
  }
}
