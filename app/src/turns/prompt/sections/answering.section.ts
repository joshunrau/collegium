import { Injectable } from '@nestjs/common';
import { uniq } from 'es-toolkit';

import { AgentRegistry } from '@/agents/agents.registry.ts';
import type { AgentProfile } from '@/agents/agents.types.ts';
import { ConversationsService } from '@/conversations/conversations.service.ts';
import { MomentFormatter } from '@/formatting/dates/moment.formatter.ts';
import { TextFormatter } from '@/formatting/text/text.formatter.ts';
import type { ModelRow } from '@/prisma/prisma.types.ts';
import { TasksService } from '@/tasks/tasks.service.ts';
import { ToolRegistry } from '@/tools/tools.registry.ts';
import { TriggersService } from '@/triggers/triggers.service.ts';

import { renderAuthoredMessage, renderAuthorName } from '../../context/context.utils.ts';
import { TurnsService } from '../../turns.service.ts';

import type { TurnPromptInput } from '../prompt.types.ts';

type AnsweredPost = Pick<
  ModelRow<'Post'>,
  'authorKind' | 'authorUsername' | 'createdAt' | 'id' | 'kind' | 'message' | 'observedAt'
>;

/** what an entry is read against: the window it sits in, the lane's previous turn, and the clock */
type EntryContext = {
  readonly now: Date;
  readonly previousStartedAt: Date | undefined;
  readonly profile: AgentProfile;
  readonly windowPostIds: ReadonlySet<string>;
};

/** the newest this many are listed; the rest are counted, and sit above too */
const SHOWN_POSTS = 5;

/** about what a post's gist takes, so five of them cost the tail little */
const EXCERPT_CHARS = 300;

/** a post outside the window with no tool to read it whole is quoted at more length instead */
const UNREADABLE_EXCERPT_CHARS = 1_500;

const excerptOf = (message: string, chars: number): string => {
  const flat = message.replace(/\s+/gu, ' ').trim();
  return flat.length <= chars ? flat : `${flat.slice(0, chars).trimEnd()}…`;
};

/**
 * §3.8, §5.2 — the posts this turn answers, first after the opening line: the post that started
 * it, what the debounce batched in, what it took from its queue and what folded into it. Each is
 * placed in the window above or named with a way to read it, so a drain or a hand-off never has to
 * guess which of the posts above are its to answer.
 */
@Injectable()
export class AnsweringSection {
  constructor(
    private readonly agentRegistry: AgentRegistry,
    private readonly conversationsService: ConversationsService,
    private readonly momentFormatter: MomentFormatter,
    private readonly tasksService: TasksService,
    private readonly textFormatter: TextFormatter,
    private readonly toolRegistry: ToolRegistry,
    private readonly triggersService: TriggersService,
    private readonly turnsService: TurnsService
  ) {}

  async render({ answering, channelId, profile }: TurnPromptInput): Promise<string | undefined> {
    if (answering === undefined) {
      return undefined;
    }
    const found = await Promise.all(
      uniq(answering.postIds).map((postId) => this.conversationsService.findUnforgotten(postId))
    );
    const posts = found
      .filter((post) => post !== undefined)
      .toSorted(
        (left, right) => left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id)
      );
    if (posts.length === 0) {
      return undefined;
    }
    const context: EntryContext = {
      now: new Date(),
      previousStartedAt: await this.turnsService.findLatestStartBefore(
        profile.username,
        channelId,
        answering.turnStartedAt
      ),
      profile,
      windowPostIds: answering.windowPostIds
    };
    const shown = posts.slice(-SHOWN_POSTS);
    const entries = await Promise.all(shown.map((post) => this.renderEntry(post, context)));
    const earlier = posts.length - shown.length;
    // joined rather than formatted: an excerpt is someone's text, and braces in it are not placeholders
    return [
      '## Posts this turn answers',
      this.textFormatter.formatBullets(entries),
      ...(earlier > 0 ? [`…and ${earlier} earlier ${earlier === 1 ? 'one' : 'ones'}, which sit above.`] : []),
      'These are the posts this turn answers. Each sits above at the time it arrived, which can be before your own last messages.'
    ].join('\n\n');
  }

  private async renderEntry(post: AnsweredPost, context: EntryContext): Promise<string> {
    const placement = await this.renderPlacement(post, context);
    const acted =
      context.previousStartedAt !== undefined && post.observedAt < context.previousStartedAt
        ? `; it arrived before your previous turn here began at ${this.momentFormatter.format(context.previousStartedAt, context.now)}, which may already have acted on it`
        : '';
    const where = `${placement.text}${acted}`;
    if (post.authorKind === 'system') {
      // §4.2 — the announcement above carries its text and its ask, framed; here it is only named
      const trigger = await this.triggersService.findAnnouncedBy(post.id);
      const named =
        trigger === undefined ? 'a post by the system bot' : `trigger ⟨${trigger.id}⟩ from ${trigger.source}`;
      return `${named}, post ${post.id}, ${where}.`;
    }
    const author = renderAuthorName(post, { displayNameOf: (username) => this.agentRegistry.displayNameOf(username) });
    return `post ${post.id}, ${where} — ${renderAuthoredMessage(author, post.authorKind, excerptOf(post.message, placement.excerptChars))}`;
  }

  /** §3.8 — where the post sits: above at its time, or older than the window with the reader this agent holds */
  private async renderPlacement(
    post: AnsweredPost,
    context: EntryContext
  ): Promise<{ excerptChars: number; text: string }> {
    const time = this.momentFormatter.format(post.createdAt, context.now);
    if (context.windowPostIds.has(post.id)) {
      return { excerptChars: EXCERPT_CHARS, text: `sits above at ${time}` };
    }
    const older = `arrived at ${time}, older than your window`;
    const unitReference =
      post.kind === 'unit' && this.toolRegistry.isGranted(context.profile, 'tasks::read')
        ? await this.tasksService.findReferenceOfPost(post.id)
        : undefined;
    if (unitReference !== undefined) {
      return { excerptChars: EXCERPT_CHARS, text: `${older}; read its unit with tasks__read ${unitReference}` };
    }
    if (this.toolRegistry.isGranted(context.profile, 'conversations::search')) {
      return {
        excerptChars: EXCERPT_CHARS,
        text: `${older}; read it whole with conversations__search postId ${post.id}`
      };
    }
    return { excerptChars: UNREADABLE_EXCERPT_CHARS, text: older };
  }
}
