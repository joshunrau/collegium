import { estimateTokens } from '@collegium/core/utils';
import { Injectable } from '@nestjs/common';

import { AgentRegistry } from '@/agents/agents.registry.ts';
import { renderPostWithAttachments } from '@/conversations/conversations.utils.ts';
import { PinsService } from '@/conversations/pins/pins.service.ts';
import { DayFormatter } from '@/formatting/dates/day.formatter.ts';
import { TextFormatter } from '@/formatting/text/text.formatter.ts';
import type { ModelRow } from '@/prisma/prisma.types.ts';

import { renderAuthorLabel, renderAuthorName } from '../../context/context.utils.ts';
import { PINNED_POSTS_TOKEN_CAP } from '../prompt.constants.ts';
import { formatCount } from '../prompt.utils.ts';

import type { TurnPromptInput } from '../prompt.types.ts';

type PinnedEntry = {
  readonly postId: string;
  readonly text: string;
};

/**
 * §3.8 — the channel's standing instructions, for every agent in it and past any episode boundary.
 * Under the cap the newest are kept and the older ones named by id, so a cut is never silent (A4).
 */
@Injectable()
export class PinnedPostsSection {
  constructor(
    private readonly agentRegistry: AgentRegistry,
    private readonly dayFormatter: DayFormatter,
    private readonly pinsService: PinsService,
    private readonly textFormatter: TextFormatter
  ) {}

  async render({ channelId }: TurnPromptInput): Promise<string | undefined> {
    const pinned = await this.pinsService.listPinned(channelId);
    if (pinned.length === 0) {
      return undefined;
    }
    const entries = pinned.map((post) => ({ postId: post.id, text: this.renderEntry(post) }));
    const shown = this.keepNewestUnderCap(entries);
    const listing = this.textFormatter.formatParagraphs(
      [
        '## Pinned in this channel',
        'Posts pinned in this channel, oldest first. Each one stands until a person unpins it:',
        '{listing}'
      ],
      { listing: shown.map(({ text }) => text).join('\n\n') }
    );
    const leftOut = entries.slice(0, entries.length - shown.length);
    if (leftOut.length === 0) {
      return listing;
    }
    const leftOutLine = this.textFormatter.formatParagraphs(
      ['{count} older pinned {posts} left out, because this section holds about {capTokens} tokens: {postIds}.'],
      {
        capTokens: formatCount(PINNED_POSTS_TOKEN_CAP),
        count: formatCount(leftOut.length),
        postIds: leftOut.map(({ postId }) => postId).join(', '),
        posts: leftOut.length === 1 ? 'post is' : 'posts are'
      }
    );
    return `${listing}\n\n${leftOutLine}`;
  }

  /** walked from the newest, stopping at the first that does not fit, so what is left out is always the oldest */
  private keepNewestUnderCap(entries: readonly PinnedEntry[]): PinnedEntry[] {
    const kept: PinnedEntry[] = [];
    let spent = 0;
    for (const entry of entries.toReversed()) {
      spent += estimateTokens(entry.text);
      if (spent > PINNED_POSTS_TOKEN_CAP) {
        break;
      }
      kept.unshift(entry);
    }
    return kept;
  }

  /** delimited as a search hit is, so the post reads as its author's bytes and never as the framework's (§3.8) */
  private renderEntry(post: ModelRow<'Post'>): string {
    const author = renderAuthorLabel(
      renderAuthorName(post, { displayNameOf: (username) => this.agentRegistry.displayNameOf(username) }),
      post.authorKind
    );
    return `By ${author} on ${this.dayFormatter.format(post.createdAt)}:\n<<<post ${post.id}\n${renderPostWithAttachments(post)}\n>>>`;
  }
}
