import { Injectable } from '@nestjs/common';

import { InjectModel } from '@/prisma/prisma.decorators.ts';
import type { Model, ModelRow } from '@/prisma/prisma.types.ts';

import { EpisodesService } from '../episodes/episodes.service.ts';
import { entryText, estimateTokens } from './window.utils.ts';

import type { WindowEntry } from '../conversations.types.ts';

type WindowBoundary = {
  eventsAfter: Date;
  postsAfter: Date;
};

type WindowInput = {
  agentUsername: string;
  budgetTokens: number;
  channelId: string;
};

@Injectable()
export class WindowService {
  constructor(
    private readonly episodesService: EpisodesService,
    @InjectModel('TurnEvent') private readonly events: Model<'TurnEvent'>,
    @InjectModel('Post') private readonly posts: Model<'Post'>
  ) {}

  /** newest-first walk under the token budget, returned oldest-first for the model (§3.8) */
  async build(input: WindowInput): Promise<WindowEntry[]> {
    const boundary = await this.resolveBoundary(input);
    const [posts, events] = await Promise.all([
      this.newestPosts(input, boundary),
      this.newestOwnEvents(input, boundary)
    ]);
    const entries: WindowEntry[] = [];
    let spentTokens = 0;
    let postIndex = 0;
    let eventIndex = 0;
    while (spentTokens < input.budgetTokens && (postIndex < posts.length || eventIndex < events.length)) {
      const post = posts[postIndex];
      const event = events[eventIndex];
      // posts carry Mattermost's clock in createdAt and this host's in observedAt, while events
      // carry only this host's — so the cross-source comparison uses observedAt, or skew between
      // the two hosts would sort a turn's trace before the post that triggered it
      const eventIsNewer =
        event !== undefined && (post === undefined || event.createdAt.getTime() >= post.observedAt.getTime());
      const entry: WindowEntry = eventIsNewer ? { event, kind: 'event' } : { kind: 'post', post: post! };
      if (eventIsNewer) {
        eventIndex += 1;
      } else {
        postIndex += 1;
      }
      entries.push(entry);
      spentTokens += estimateTokens(entryText(entry));
    }
    return entries.reverse();
  }

  /**
   * The trace of the reading agent's own turns only, never a peer's: tool results carry per-agent
   * authority (§3.4), and a channel-scoped trace would feed private memory into every peer's
   * context (§3.6). Peers are read through their posts alone.
   */
  private newestOwnEvents(input: WindowInput, boundary: undefined | WindowBoundary): Promise<ModelRow<'TurnEvent'>[]> {
    return this.events.findMany({
      orderBy: [{ createdAt: 'desc' }, { sequence: 'desc' }],
      take: input.budgetTokens + 1,
      where: {
        turn: { agentUsername: input.agentUsername, channelId: input.channelId },
        ...(boundary && { createdAt: { gt: boundary.eventsAfter } })
      }
    });
  }

  /** every entry costs at least one token, so a fetch this size can never cut the walk short */
  private newestPosts(input: WindowInput, boundary: undefined | WindowBoundary): Promise<ModelRow<'Post'>[]> {
    return this.posts.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: input.budgetTokens + 1,
      where: {
        channelId: input.channelId,
        isForgotten: false,
        ...(boundary && { createdAt: { gt: boundary.postsAfter } })
      }
    });
  }

  /** each side of the boundary is cut on its own clock: posts on Mattermost's, events on this host's */
  private async resolveBoundary(input: WindowInput): Promise<undefined | WindowBoundary> {
    const boundaryPostId = await this.episodesService.latestBoundaryPostId(input.agentUsername, input.channelId);
    if (boundaryPostId === undefined) {
      return undefined;
    }
    const boundaryPost = await this.posts.findFirst({
      select: { createdAt: true, observedAt: true },
      where: { id: boundaryPostId }
    });
    if (!boundaryPost) {
      return undefined;
    }
    return { eventsAfter: boundaryPost.observedAt, postsAfter: boundaryPost.createdAt };
  }
}
