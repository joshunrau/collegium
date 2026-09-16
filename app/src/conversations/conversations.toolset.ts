import { CONVERSATIONS_TOOLSET_DEF, implementToolset } from '@collegium/core/toolsets';
import { Result } from '@collegium/core/utils';
import { z } from 'zod';

import { ROSTER_SERVICE_TOKEN } from '@/channels/channels.tokens.ts';

import { SEARCH_SERVICE_TOKEN } from './conversations.tokens.ts';
import { endOfUtcDay, renderSearchHits, startOfUtcDay } from './search/search.utils.ts';

const $Count = z.number().int().min(1).max(25).default(10);

const $Day = z.iso.date();

export const CONVERSATIONS_TOOLSET = implementToolset(CONVERSATIONS_TOOLSET_DEF, {
  services: { roster: ROSTER_SERVICE_TOKEN, search: SEARCH_SERVICE_TOKEN },
  tools: {
    // §3.8 — the roster decides which channels this turn may read from, never the model
    search: {
      concurrent: true,
      description:
        'Search past posts by text, including your own replies, across the channels you are in whose readers ' +
        'include everyone who can read this channel. Returns the newest matches first, each with its post id, ' +
        'channel, author and time. Reaches back no further than the most recent reset in each channel.',
      execute: async (args, context) => {
        const channels = context.roster.listReachableFrom(context.turn.agentUsername, context.turn.channelId);
        const hits = await context.search.find({
          agentUsername: context.turn.agentUsername,
          authorUsername: args.author,
          channels,
          from: args.from === undefined ? undefined : startOfUtcDay(args.from),
          limit: args.count,
          query: args.query,
          until: args.until === undefined ? undefined : endOfUtcDay(args.until)
        });
        return Result.ok({ text: renderSearchHits(hits) });
      },
      parameters: z.object({
        author: z.string().min(1).optional().describe('Only posts by this username, without the @'),
        count: $Count.describe('How many matches to return'),
        from: $Day.optional().describe('Only posts on or after this day, as YYYY-MM-DD in UTC'),
        query: z.string().min(1).describe('Text to find anywhere in a post, matched without regard to case'),
        until: $Day.optional().describe('Only posts on or before this day, as YYYY-MM-DD in UTC')
      }),
      retryable: true,
      traceDetail: (args) => `"${args.query}"`
    }
  }
});
