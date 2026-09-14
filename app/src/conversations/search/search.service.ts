import { Injectable } from '@nestjs/common';

import { InjectModel } from '@/prisma/prisma.decorators.ts';
import type { Model } from '@/prisma/prisma.types.ts';

import { EpisodesService } from '../episodes/episodes.service.ts';

import type { SearchHit, SearchInput } from '../conversations.types.ts';

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
    const nameByChannelId = new Map(input.channels.map((channel) => [channel.channelId, channel.name]));
    const perChannel = await Promise.all(
      input.channels.map(async ({ channelId }) => {
        const boundary = await this.episodesService.latestBoundary(input.agentUsername, channelId);
        return { channelId, ...(boundary && { createdAt: { gt: boundary.postsAfter } }) };
      })
    );
    const rows = await this.posts.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: input.limit,
      where: {
        isForgotten: false,
        kind: { notIn: ['notice', 'status'] },
        message: { contains: input.query },
        OR: perChannel,
        ...(input.authorUsername !== undefined && { authorUsername: input.authorUsername }),
        ...((input.from ?? input.until) && { createdAt: { gte: input.from, lte: input.until } })
      }
    });
    return rows.map((row) => ({
      authorUsername: row.authorUsername,
      channelName: nameByChannelId.get(row.channelId) ?? row.channelId,
      createdAt: row.createdAt,
      id: row.id,
      message: row.message
    }));
  }
}
