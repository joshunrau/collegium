import { describeReplaySubject } from '@collegium/core/tools';
import type { ToolResult } from '@collegium/core/tools';
import { implementToolset, WEB_TOOLSET_DEF } from '@collegium/core/toolsets';
import { Result } from '@collegium/core/utils';
import { match } from 'ts-pattern';
import { z } from 'zod';

import { SEARCH_TIMEOUT_MS } from './search/search.constants.ts';
import { renderSearchResults } from './search/search.utils.ts';
import { FETCH_TIMEOUT_MS, MARKDOWN_CAP_CHARS } from './web.constants.ts';
import { SEARCH_SERVICE_TOKEN, WEB_SERVICE_TOKEN } from './web.tokens.ts';
import { describeWebFailureOutcome, renderWebFailure, renderWebPage, renderWebSnapshot } from './web.utils.ts';

import type { SearchFailure, SearchResult } from './search/search.types.ts';
import type { WebFailure, WebPage, WebSnapshot } from './web.types.ts';

const REF_SHAPE = /^e\d+$/;

/** navigation is bounded at 30s and settle at 3s inside the session; this backstops a wedged browser */
const WEB_TIMEOUT_MS = 45_000;

const $Ref = z.string().regex(REF_SHAPE);

const DESCRIPTION_PREAMBLE =
  'Browse the web in a real rendered browser (JavaScript runs). One page per turn, shared by the web tools; every ' +
  'action returns a fresh snapshot of the page as markdown with ⟨eN⟩ element refs. ';

/**
 * The browser being down is infrastructure, not something the model can reason its way past. A
 * page read is acted on in the turn that made it, so its replay subject names the page, and the
 * part of it the result held when the whole did not fit (§3.8).
 */
function toPageResult<TPage extends WebPage>(
  result: Result<TPage, WebFailure>,
  render: (page: TPage) => string,
  describeOutcome: (page: TPage) => string | undefined
): ToolResult {
  if (!result.success) {
    if (result.error.kind === 'unreachable') {
      return Result.err({ kind: 'exception', message: result.error.message });
    }
    return Result.ok({ text: renderWebFailure(result.error), traceOutcome: describeWebFailureOutcome(result.error) });
  }
  const { shown, url } = result.value;
  const text = render(result.value);
  const name =
    shown === undefined ? `page ${url}` : `page ${url} (characters ${shown.from}–${shown.to} of ${shown.total})`;
  const traceOutcome = describeOutcome(result.value);
  return Result.ok({
    replaySubject: describeReplaySubject(name, text),
    text,
    ...(traceOutcome !== undefined && { traceOutcome })
  });
}

/** §8.1 — a status worth a mark is one that is not success: a 403 listed like a success is what the bare line hid */
const httpStatusOutcome = (page: WebPage): string | undefined => {
  return page.status >= 300 ? `HTTP ${page.status}` : undefined;
};

/** §8.1 — the page the action landed on, named rather than addressed: a client-rendered pager's URL never changes */
const landingOutcome = (page: WebPage): string => `→ ${page.title === '' ? page.url : page.title}`;

const toSnapshotResult = (
  result: Result<WebSnapshot, WebFailure>,
  describeOutcome: (page: WebSnapshot) => string | undefined = landingOutcome
): ToolResult => {
  return toPageResult(result, renderWebSnapshot, describeOutcome);
};

/** throttling is weather the model can plan around; bad credentials or a dead provider end the turn loudly */
function toSearchResult(query: string, result: Result<SearchResult[], SearchFailure>): ToolResult {
  if (result.success) {
    return Result.ok({ text: renderSearchResults(query, result.value) });
  }
  return match(result.error)
    .with({ kind: 'rate-limited' }, (): ToolResult => {
      return Result.ok({
        text: 'The search provider is rate-limiting this deployment. Search again later in the turn, or read a page you already know with web::fetch.'
      });
    })
    .with({ kind: 'rejected' }, ({ message }): ToolResult => Result.err({ kind: 'invalid-arguments', message }))
    .with({ kind: 'auth' }, { kind: 'unavailable' }, ({ message }): ToolResult => {
      return Result.err({ kind: 'exception', message });
    })
    .exhaustive();
}

/**
 * Ungated as a read instrument (§3.4): the per-agent grant decides who browses, the status post
 * traces every action. A click or fill may commit a side effect on the page, and even a navigation
 * can, so no browser tool is retryable: a timeout leaves us unable to say whether it landed (§7.2).
 * `fetch` and `search` are the exceptions — a scriptless GET commits nothing, so a timeout is a plain failure.
 * None of the session tools is `mutating` even so: §8.1 keeps that question separate from
 * retryability, and what these act on is the turn's own page.
 */
export const WEB_TOOLSET = implementToolset(WEB_TOOLSET_DEF, {
  services: { search: SEARCH_SERVICE_TOKEN, web: WEB_SERVICE_TOKEN },
  tools: {
    click: {
      description: `${DESCRIPTION_PREAMBLE}Click an element from the latest snapshot, e.g. to follow a link or submit a form.`,
      execute: async (args, context) => toSnapshotResult(await context.web.click(context.turn.turnId, args.ref)),
      mutating: false,
      parameters: z.object({
        ref: $Ref.describe('An element ref (shown as ⟨eN⟩) from the latest snapshot')
      }),
      supersedable: true,
      timeoutMs: WEB_TIMEOUT_MS,
      traceDetail: (args) => `⟨${args.ref}⟩`
    },
    fetch: {
      concurrent: true,
      description:
        'Fetch a URL over plain HTTP and read it as markdown — no browser, no JavaScript, no session; ' +
        "this turn's browser page is untouched. Cheaper and faster than navigate: use it first for articles, " +
        'documentation, and static pages, and switch to navigate when the result says the page has no static content ' +
        'or when the task needs a click, a search, or a sign-in. A page too long for one result is cut and says ' +
        'where to read on from; each call fetches the page again.',
      execute: async (args, context) => {
        return toPageResult(
          await context.web.fetch(args.url, args.startChar, args.maxChars),
          renderWebPage,
          httpStatusOutcome
        );
      },
      parameters: z.object({
        maxChars: z
          .number()
          .int()
          .min(1_000)
          .max(MARKDOWN_CAP_CHARS)
          .optional()
          .describe('How much of the page to return, in characters; omit for as much as one result holds'),
        startChar: z
          .number()
          .int()
          .default(0)
          .describe('Where in the page to start reading, in characters; a negative value counts back from the end'),
        url: z.url().describe('The absolute http(s) URL of a page or text resource to fetch')
      }),
      retryable: true,
      supersedable: true,
      timeoutMs: FETCH_TIMEOUT_MS + 5_000,
      traceDetail: (args) => {
        const width = args.maxChars === undefined ? '' : ` for ${args.maxChars}`;
        return args.startChar === 0 ? `${args.url}${width}` : `${args.url} from ${args.startChar}${width}`;
      }
    },
    fill: {
      description: `${DESCRIPTION_PREAMBLE}Type into an input from the latest snapshot, replacing its current value — including signing in when the task calls for it.`,
      execute: async (args, context) => {
        return toSnapshotResult(
          await context.web.fill(context.turn.turnId, { pressEnter: args.pressEnter, ref: args.ref, text: args.text })
        );
      },
      mutating: false,
      parameters: z.object({
        pressEnter: z.boolean().optional().describe('Press Enter after typing, e.g. to run a search'),
        ref: $Ref.describe('The ref of the input to fill, from the latest snapshot'),
        text: z.string().describe('The text to type, replacing the current value')
      }),
      supersedable: true,
      timeoutMs: WEB_TIMEOUT_MS,
      traceDetail: (args) => `⟨${args.ref}⟩ with "${args.text}"${args.pressEnter === true ? ' then press "Enter"' : ''}`
    },
    hover: {
      description:
        `${DESCRIPTION_PREAMBLE}Move the pointer onto an element from the latest snapshot, to reveal what only ` +
        'appears on hover — a drop-down menu, a submenu, a tooltip. A ref the snapshot marks `hidden` cannot be ' +
        'clicked or filled until something reveals it; hovering its parent menu is usually what does.',
      execute: async (args, context) => toSnapshotResult(await context.web.hover(context.turn.turnId, args.ref)),
      mutating: false,
      parameters: z.object({
        ref: $Ref.describe('An element ref (shown as ⟨eN⟩) from the latest snapshot')
      }),
      supersedable: true,
      timeoutMs: WEB_TIMEOUT_MS,
      traceDetail: (args) => `⟨${args.ref}⟩`
    },
    navigate: {
      description: `${DESCRIPTION_PREAMBLE}Open a URL in this turn's page, replacing whatever it showed.`,
      execute: async (args, context) => {
        return toSnapshotResult(await context.web.navigate(context.turn.turnId, args.url), httpStatusOutcome);
      },
      mutating: false,
      parameters: z.object({
        url: z.url().describe("The absolute http(s) URL of a page to open in this turn's page")
      }),
      supersedable: true,
      timeoutMs: WEB_TIMEOUT_MS,
      traceDetail: (args) => args.url
    },
    search: {
      concurrent: true,
      description:
        'Search the public web and get back ranked results — a title, URL, and short snippet each, never the page itself. ' +
        'The index holds public pages only, so a page on your own network is not findable here even when fetch can open it. ' +
        'Read a result with fetch, or navigate when it needs a browser. Search operators such as "quoted phrases" and site: work.',
      execute: async (args, context) => {
        const { search } = context.settings;
        if (!search) {
          throw new Error('web::search ran for an agent whose web settings configure no search provider');
        }
        return toSearchResult(args.query, await context.search.search(search.provider, args));
      },
      isAvailableWith: (settings) => settings.search !== undefined,
      parameters: z.object({
        count: z.number().int().min(1).max(20).default(10).describe('How many results to return'),
        query: z.string().min(1).max(600).describe('What to search for')
      }),
      retryable: true,
      timeoutMs: SEARCH_TIMEOUT_MS + 5_000,
      traceDetail: (args) => `"${args.query}"`
    }
  }
});
