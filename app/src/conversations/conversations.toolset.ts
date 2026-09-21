import { CONVERSATIONS_TOOLSET_DEF, implementToolset } from '@collegium/core/toolsets';
import { Result } from '@collegium/core/utils';
import { z } from 'zod';

import { ROSTER_SERVICE_TOKEN } from '@/channels/channels.tokens.ts';

import { SEARCH_SERVICE_TOKEN } from './conversations.tokens.ts';
import {
  endOfUtcDay,
  renderMatchCount,
  renderSearchHits,
  renderSearchPost,
  startOfUtcDay
} from './search/search.utils.ts';

const $Count = z.number().int().min(1).max(25).default(10);

const $Day = z.iso.date();

const $SearchArgs = z.object({
  author: z.string().min(1).optional().describe('Only posts by this username, without the @'),
  count: $Count.describe('How many matches to return'),
  from: $Day.optional().describe('Only posts on or after this day, as YYYY-MM-DD in UTC; omit for no lower bound'),
  postId: z
    .string()
    .min(1)
    .optional()
    .describe(
      'The id of one post to read whole, as a hit header shows it; give this instead of query, never with it, ' +
        'and the other filters do not apply'
    ),
  query: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Text to find anywhere in a post, as one literal phrase matched without regard to case; give this or postId'
    ),
  until: $Day.optional().describe('Only posts on or before this day, as YYYY-MM-DD in UTC; omit for no upper bound')
});

/** what one call reads (§3.8): a query to match, or one post's id to read whole — never both, never neither */
type SearchTarget =
  | (z.infer<typeof $SearchArgs> & { readonly postId: string; readonly query?: undefined })
  | (z.infer<typeof $SearchArgs> & { readonly postId?: undefined; readonly query: string });

const $Search = $SearchArgs.refine(
  (args): args is SearchTarget => (args.postId === undefined) !== (args.query === undefined),
  'give either query or postId, never both and never neither'
);

function renderFilters(args: { author?: string; from?: string; until?: string }): string {
  const filters = [
    args.author === undefined ? undefined : `author ${args.author}`,
    args.from === undefined && args.until === undefined ? undefined : `${args.from ?? '…'}..${args.until ?? '…'}`
  ].filter((filter) => filter !== undefined);
  return filters.length === 0 ? '' : ` (${filters.join(', ')})`;
}

export const CONVERSATIONS_TOOLSET = implementToolset(CONVERSATIONS_TOOLSET_DEF, {
  services: { roster: ROSTER_SERVICE_TOKEN, search: SEARCH_SERVICE_TOKEN },
  tools: {
    // §3.8 — the roster decides which channels this turn may read from, never the model
    search: {
      concurrent: true,
      description:
        'Search past posts by text, including your own replies, across the channels you are in whose readers ' +
        'include everyone who can read this channel. The query is one literal phrase matched as a substring, ' +
        'without regard to case and with no stemming or synonyms, so a distinctive word or two finds what a ' +
        'sentence does not. Returns the newest matches first, each with its post id, channel, author and time, ' +
        'and a long post cut to a window around the match; pass postId instead of query to read one post whole. ' +
        "Reaches back no further than each channel's most recent episode boundary.",
      execute: async (args, context) => {
        const channels = context.roster.listReachableFrom(context.turn.agentUsername, context.turn.channelId);
        if (args.postId !== undefined) {
          const hit = await context.search.findById({
            agentUsername: context.turn.agentUsername,
            channels,
            postId: args.postId
          });
          return Result.ok({
            text: renderSearchPost(hit, args.postId),
            traceOutcome: renderMatchCount(hit === undefined ? 0 : 1)
          });
        }
        const hits = await context.search.find({
          agentUsername: context.turn.agentUsername,
          authorUsername: args.author,
          channels,
          // §3.8 — the post that started the turn is already in context verbatim
          ...(context.turn.triggeringPostId !== null && { excludePostIds: [context.turn.triggeringPostId] }),
          from: args.from === undefined ? undefined : startOfUtcDay(args.from),
          limit: args.count,
          query: args.query,
          until: args.until === undefined ? undefined : endOfUtcDay(args.until)
        });
        return Result.ok({ text: renderSearchHits(hits, args.query), traceOutcome: renderMatchCount(hits.length) });
      },
      parameters: $Search,
      retryable: true,
      traceDetail: (args) => {
        return args.postId === undefined ? `"${args.query}"${renderFilters(args)}` : `post ${args.postId}`;
      }
    }
  }
});
