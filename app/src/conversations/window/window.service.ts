import { Injectable } from '@nestjs/common';

import { InjectModel } from '@/prisma/prisma.decorators.ts';
import type { Model, ModelRow, PostKind } from '@/prisma/prisma.types.ts';

import { EpisodesService } from '../episodes/episodes.service.ts';
import { createPagedSource, createUnitCollector, instantOf, replayLineOf } from './window.utils.ts';

import type { EpisodeBoundary, WindowEntry, WindowResult } from '../conversations.types.ts';

type WindowInput = {
  agentUsername: string;
  budgetTokens: number;
  channelId: string;
  /** what entries cost the model that reads them, measured on what they render to, so the budget and the window cannot disagree (§3.8) */
  costOf: (entries: readonly WindowEntry[]) => number;
};

type RecentActionsInput = {
  agentUsername: string;
  /** strictly older than this instant, so no action the window already carries is said twice */
  before: Date;
  channelId: string;
  take: number;
};

type RecentPeopleInput = {
  agentUsername: string;
  channelId: string;
  take: number;
};

type PageQuery = {
  /** only rows at or after this instant — the anchored read, which takes no page bound */
  since?: Date;
  skip: number;
  take?: number;
};

/**
 * §3.8 — an agent reads its colleagues through what they said, never through their machinery: a
 * peer's status post is its trace rendered, and is left out as the agent's own is. A notice stays,
 * being one line the framework spoke under the peer's name.
 */
const WINDOW_POST_KINDS: PostKind[] = ['message', 'notice', 'reply'];

/** how many rows one page of the newest-first walk reads; the walk stops at the budget, so a long channel is never read whole */
const PAGE_SIZE = 200;

/**
 * The share of the budget a window is trimmed to once it overflows, so its oldest entry then holds
 * still across the turns it takes to fill back up. An oldest entry that moved every turn would
 * change the prompt's prefix every turn, and a provider's cache matches prefixes.
 */
const LOW_WATER_SHARE = 0.75;

@Injectable()
export class WindowService {
  /** per agent and channel, the instant of the oldest entry the last window kept; in memory, since a restart costs one cache miss and nothing else */
  private readonly anchors = new Map<string, Date>();

  constructor(
    private readonly episodesService: EpisodesService,
    @InjectModel('TurnEvent') private readonly events: Model<'TurnEvent'>,
    @InjectModel('Post') private readonly posts: Model<'Post'>
  ) {}

  /** the newest history under the budget, oldest first for the model, its oldest entry held fixed while everything since still fits (§3.8) */
  async build(input: WindowInput): Promise<WindowResult> {
    const boundary = await this.episodesService.latestBoundary(input.agentUsername, input.channelId);
    const key = this.anchorKey(input.agentUsername, input.channelId);
    const anchor = this.anchors.get(key);
    if (anchor !== undefined) {
      const anchored = await this.readSince(input, boundary, anchor);
      if (input.costOf(anchored) <= input.budgetTokens) {
        return { entries: anchored.toReversed(), oldestAt: anchor };
      }
    }
    const share = anchor === undefined ? 1 : LOW_WATER_SHARE;
    const entries = await this.walkNewestFirst(input, boundary, Math.floor(input.budgetTokens * share));
    const oldest = entries.at(-1);
    const oldestAt = oldest === undefined ? undefined : instantOf(oldest);
    if (oldestAt === undefined) {
      this.anchors.delete(key);
    } else {
      this.anchors.set(key, oldestAt);
    }
    return { entries: entries.toReversed(), oldestAt };
  }

  /** §8.5 — a cleared channel's anchors name entries that no longer exist, so its next window starts afresh */
  forgetAnchorsIn(channelId: string): void {
    for (const key of this.anchors.keys()) {
      if (key.endsWith(`\n${channelId}`)) {
        this.anchors.delete(key);
      }
    }
  }

  /**
   * §3.11 — who has posted here as a person, the latest poster first, read off the kind the store
   * recorded rather than off membership, which does not say who is a person. It reaches back no
   * further than the window may, so a reset or a forgotten post hides an author as it hides the post.
   */
  async listRecentPeople(input: RecentPeopleInput): Promise<string[]> {
    const boundary = await this.episodesService.latestBoundary(input.agentUsername, input.channelId);
    const authors = await this.posts.groupBy({
      _max: { createdAt: true },
      by: ['authorUsername'],
      orderBy: { _max: { createdAt: 'desc' } },
      take: input.take,
      where: {
        authorKind: 'human',
        channelId: input.channelId,
        ...(boundary && { createdAt: { gt: boundary.postsAfter } }),
        isForgotten: false
      }
    });
    return authors.map(({ authorUsername }) => authorUsername);
  }

  /** §8.4 — where the last window built here reached back to, for a reader outside a turn; nothing built yet means nothing to be earlier than */
  reachesBackTo(agentUsername: string, channelId: string): Date | undefined {
    return this.anchors.get(this.anchorKey(agentUsername, channelId));
  }

  /**
   * §3.8 — what this agent itself did in this channel before the window reaches, newest first, one
   * declared line each. Its own turns only and never past the episode boundary, for the reasons the
   * window walks under the same two conditions.
   */
  async readRecentActions(input: RecentActionsInput): Promise<string[]> {
    const boundary = await this.episodesService.latestBoundary(input.agentUsername, input.channelId);
    const rows = await this.events.findMany({
      orderBy: [{ createdAt: 'desc' }, { sequence: 'desc' }],
      take: input.take,
      where: {
        createdAt: { ...(boundary && { gt: boundary.eventsAfter }), lt: input.before },
        kind: 'tool_result',
        turn: { agentUsername: input.agentUsername, channelId: input.channelId }
      }
    });
    return rows.flatMap((row) => replayLineOf(row.payload) ?? []);
  }

  private anchorKey(agentUsername: string, channelId: string): string {
    return `${agentUsername}\n${channelId}`;
  }

  /**
   * The trace of the reading agent's own turns only, never a peer's: tool results carry per-agent
   * authority (§3.4), and a channel-scoped trace would feed private memory into every peer's
   * context (§3.6). Peers are read through their posts alone.
   */
  private readEvents(
    input: WindowInput,
    boundary: EpisodeBoundary | undefined,
    page: PageQuery
  ): Promise<ModelRow<'TurnEvent'>[]> {
    return this.events.findMany({
      orderBy: [{ createdAt: 'desc' }, { sequence: 'desc' }],
      skip: page.skip,
      ...(page.take !== undefined && { take: page.take }),
      where: {
        createdAt: {
          ...(boundary && { gt: boundary.eventsAfter }),
          ...(page.since !== undefined && { gte: page.since })
        },
        turn: { agentUsername: input.agentUsername, channelId: input.channelId }
      }
    });
  }

  /**
   * A post the reading agent's own turn authored is left out: the turn's final `assistant_message`
   * event already carries that text, and a notice is the framework speaking.
   */
  private readPosts(
    input: WindowInput,
    boundary: EpisodeBoundary | undefined,
    page: PageQuery
  ): Promise<ModelRow<'Post'>[]> {
    return this.posts.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: page.skip,
      ...(page.take !== undefined && { take: page.take }),
      where: {
        channelId: input.channelId,
        createdAt: {
          ...(boundary && { gt: boundary.postsAfter }),
          ...(page.since !== undefined && { gte: page.since })
        },
        isForgotten: false,
        kind: { in: WINDOW_POST_KINDS },
        NOT: { authoringTurnId: { not: null }, authorUsername: input.agentUsername }
      }
    });
  }

  /** everything since the anchor, newest first, however much it costs — the caller decides whether it still fits */
  private async readSince(
    input: WindowInput,
    boundary: EpisodeBoundary | undefined,
    since: Date
  ): Promise<WindowEntry[]> {
    const [posts, events] = await Promise.all([
      this.readPosts(input, boundary, { since, skip: 0 }),
      this.readEvents(input, boundary, { since, skip: 0 })
    ]);
    const entries: WindowEntry[] = [];
    let postIndex = 0;
    let eventIndex = 0;
    while (postIndex < posts.length || eventIndex < events.length) {
      const post = posts[postIndex];
      const event = events[eventIndex];
      if (event !== undefined && (post === undefined || event.createdAt.getTime() >= post.observedAt.getTime())) {
        entries.push({ event, kind: 'event' });
        eventIndex += 1;
      } else if (post !== undefined) {
        entries.push({ kind: 'post', post });
        postIndex += 1;
      }
    }
    return entries;
  }

  /**
   * The newest-first walk under a token budget, reading each source a page at a time. A unit is
   * costed before it is admitted, and the first that does not fit ends the walk: skipping it for
   * something older would leave a gap the model cannot see (§3.8).
   */
  private async walkNewestFirst(
    input: WindowInput,
    boundary: EpisodeBoundary | undefined,
    budgetTokens: number
  ): Promise<WindowEntry[]> {
    const posts = createPagedSource((skip) => this.readPosts(input, boundary, { skip, take: PAGE_SIZE }), PAGE_SIZE);
    const events = createPagedSource((skip) => this.readEvents(input, boundary, { skip, take: PAGE_SIZE }), PAGE_SIZE);
    const units = createUnitCollector();
    const walked: WindowEntry[] = [];
    const admitted = new Set<WindowEntry>();
    let spentTokens = 0;
    for (;;) {
      const [post, event] = await Promise.all([posts.peek(), events.peek()]);
      // posts carry Mattermost's clock in createdAt and this host's in observedAt, while events
      // carry only this host's — so the cross-source comparison uses observedAt, or skew between
      // the two hosts would sort a turn's trace before the post that triggered it
      let entry: WindowEntry;
      if (event !== undefined && (post === undefined || event.createdAt.getTime() >= post.observedAt.getTime())) {
        events.advance();
        entry = { event, kind: 'event' };
      } else if (post !== undefined) {
        posts.advance();
        entry = { kind: 'post', post };
      } else {
        break;
      }
      walked.push(entry);
      const unit = units.take(entry);
      if (unit === undefined) {
        continue;
      }
      const cost = input.costOf(unit);
      if (spentTokens + cost > budgetTokens) {
        break;
      }
      spentTokens += cost;
      for (const member of unit) {
        admitted.add(member);
      }
    }
    return walked.filter((entry) => admitted.has(entry));
  }
}
