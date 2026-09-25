import { describeReplaySubject } from '@collegium/core/tools';
import type { ToolOutput, ToolResult } from '@collegium/core/tools';
import { implementToolset, WEB_TOOLSET_DEF } from '@collegium/core/toolsets';
import { Result } from '@collegium/core/utils';
import { match } from 'ts-pattern';
import { z } from 'zod';

import { holdsWholePage } from './reading/reading.utils.ts';
import { SEARCH_TIMEOUT_MS } from './search/search.constants.ts';
import { renderSearchResults } from './search/search.utils.ts';
import { DEFAULT_WINDOW_CHARS, FETCH_TIMEOUT_MS, MARKDOWN_CAP_CHARS, PDF_READ_TIMEOUT_MS } from './web.constants.ts';
import { describeWebFailureOutcome, renderWebFailure, renderWebPage, renderWebSnapshot } from './web.renderer.ts';
import { SEARCH_SERVICE_TOKEN, WEB_SERVICE_TOKEN } from './web.tokens.ts';

import type { SearchFailure, SearchResult } from './search/search.types.ts';
import type { FetchedPage, PageRead, WebFailure, WebPage, WebSnapshot } from './web.types.ts';

const REF_SHAPE = /^e\d+$/;

/** navigation is bounded at 30s and settle at 3s inside the session; this backstops a wedged browser */
const WEB_TIMEOUT_MS = 45_000;

const $Ref = z.string().regex(REF_SHAPE);

type $FetchArgs = z.infer<typeof $FetchArgs>;
const $FetchArgs = z
  .object({
    find: z
      .array(z.string().trim().min(1).max(200))
      .min(1)
      .max(5)
      .optional()
      .describe(
        'Up to five phrases to look for, each matched without regard to case; the result is where each occurs, ' +
          'with the text around it and its offset, instead of the page. Give this or startChar and maxChars, not both'
      ),
    maxChars: z
      .number()
      .int()
      .min(1_000)
      .max(MARKDOWN_CAP_CHARS)
      .optional()
      .describe(`How much of the page to return, in characters; omit for ${DEFAULT_WINDOW_CHARS}`),
    startChar: z
      .number()
      .int()
      .default(0)
      .describe('Where in the page to start reading, in characters; a negative value counts back from the end'),
    url: z.url().describe('The absolute http(s) URL of a page, PDF or text resource to fetch'),
    wholePage: z
      .boolean()
      .default(false)
      .describe(
        "Include the page's navigation, header and footer, which are otherwise left out; offsets and lengths " +
          'from a read with it do not apply to one without'
      )
  })
  .refine(
    (args) => args.find === undefined || (args.startChar === 0 && args.maxChars === undefined),
    'give find to search the page, or startChar and maxChars to read part of it, not both'
  );

function toPageRead(args: $FetchArgs): PageRead {
  return args.find === undefined
    ? { kind: 'window', maxChars: args.maxChars, startChar: args.startChar, wholePage: args.wholePage }
    : { kind: 'find', phrases: args.find, wholePage: args.wholePage };
}

function renderPhrases(phrases: readonly string[]): string {
  return phrases.map((phrase) => `"${phrase}"`).join(', ');
}

/** §3.8 — the page, and the part of it the result held when the whole did not fit */
function describePageSubject({ shown, url }: WebPage): string {
  return shown === undefined || holdsWholePage(shown)
    ? `page ${url}`
    : `page ${url} (characters ${shown.from}–${shown.to} of ${shown.total})`;
}

/** what a page result shows the model (§3.8) */
type RenderedPageResult = Pick<ToolOutput, 'text'>;

/** §3.8 — a fetched page; one too long for the turn's view is read on by reference, past its own read-on footer */
function renderFetchedPage(page: FetchedPage): RenderedPageResult {
  return { text: renderWebPage(page) };
}

const DESCRIPTION_PREAMBLE =
  'Browse the web in a real rendered browser (JavaScript runs). One page per turn, shared by the web tools; every ' +
  'action returns a fresh snapshot of the page as markdown with ⟨eN⟩ element refs. ';

/**
 * The browser being down is infrastructure, not something the model can reason its way past. A
 * page read is acted on in the turn that made it, so its replay subject names what the result held
 * of the page (§3.8).
 */
function toPageResult<TPage extends WebPage>(
  result: Result<TPage, WebFailure>,
  render: (page: TPage) => RenderedPageResult,
  describeOutcome: (page: TPage) => string | undefined,
  describeSubject: (page: TPage) => string = describePageSubject,
  identifyContent: (page: TPage) => string | undefined = () => undefined
): ToolResult {
  if (!result.success) {
    if (result.error.kind === 'unreachable') {
      return Result.err({ kind: 'exception', message: result.error.message });
    }
    return Result.ok({ text: renderWebFailure(result.error), traceOutcome: describeWebFailureOutcome(result.error) });
  }
  const { text } = render(result.value);
  const traceOutcome = describeOutcome(result.value);
  const contentIdentity = identifyContent(result.value);
  return Result.ok({
    replaySubject: describeReplaySubject(describeSubject(result.value), text),
    text,
    ...(contentIdentity !== undefined && { contentIdentity }),
    ...(traceOutcome !== undefined && { traceOutcome })
  });
}

/**
 * §3.8 — a successful read is its body, whatever address served it. Not an error page's: a site's
 * 404 page is the same at every address it has nothing at, which says nothing about any of them.
 */
const identifyReadBody = (page: WebPage): string | undefined => {
  return page.status >= 200 && page.status < 300 ? page.markdown : undefined;
};

/** §8.1 — a status worth a mark is one that is not success: a 403 listed like a success is what the bare line hid */
const httpStatusOutcome = (page: WebPage): string | undefined => {
  return page.status >= 300 ? `HTTP ${page.status}` : undefined;
};

/** §8.1 — a find that matched nothing must not trace like one that did */
const describeFound = (matches: number): string => {
  return matches === 0 ? '⚠️ no matches' : `${matches} match${matches === 1 ? '' : 'es'}`;
};

/** §8.1 — and what a find came to, and the rate limit a fetch waited out on the way (§3.4) */
const fetchOutcome = (page: FetchedPage): string | undefined => {
  const parts = [
    httpStatusOutcome(page),
    page.retry && `retried after HTTP ${page.retry.status}`,
    page.matches === undefined ? undefined : describeFound(page.matches)
  ].filter((part) => part !== undefined);
  return parts.length === 0 ? undefined : parts.join(', ');
};

/** §8.1 — the page the action landed on, named rather than addressed: a client-rendered pager's URL never changes */
const landingOutcome = (page: WebPage): string => `→ ${page.title === '' ? page.url : page.title}`;

const toSnapshotResult = (
  result: Result<WebSnapshot, WebFailure>,
  describeOutcome: (page: WebSnapshot) => string | undefined = landingOutcome
): ToolResult => {
  return toPageResult(result, (snapshot) => ({ text: renderWebSnapshot(snapshot) }), describeOutcome);
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
 * traces every action. A click, fill or select may commit a side effect on the page, and even a
 * navigation can, so no browser tool is retryable: a timeout leaves us unable to say whether it landed (§7.2).
 * `fetch` and `search` are the exceptions — a scriptless GET commits nothing, so a timeout is a plain failure.
 */
export const WEB_TOOLSET = implementToolset(WEB_TOOLSET_DEF, {
  services: { search: SEARCH_SERVICE_TOKEN, web: WEB_SERVICE_TOKEN },
  tools: {
    click: {
      description: `${DESCRIPTION_PREAMBLE}Click an element from the latest snapshot, e.g. to follow a link or submit a form.`,
      execute: async (args, context) => toSnapshotResult(await context.web.click(context.turn.turnId, args.ref)),
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
        'or the site refused a read without a browser, or when the task needs a click, a search, or a sign-in. ' +
        "The page's navigation, header and footer are left " +
        'out unless wholePage is set, and the result says how many characters that left out. A result holds the first ' +
        `${DEFAULT_WINDOW_CHARS} characters and says where to read on from. To find a field in a long page, such as ` +
        'an email, a phone number or a heading, pass find with a few phrases instead: the result is where each ' +
        'occurs, with the text around it and an offset to read from. A PDF is read the same way, as its text layer ' +
        'with each page under a [page N of M] marker; a scanned PDF has no text layer and says so. ' +
        'Each call fetches the page again.',
      execute: async (args, context) => {
        const read = toPageRead(args);
        const fetched = await context.web.fetch(args.url, read);
        if (read.kind === 'find') {
          return toPageResult(fetched, renderFetchedPage, fetchOutcome, ({ url }) => {
            return `places of ${renderPhrases(read.phrases)} in page ${url}`;
          });
        }
        return toPageResult(fetched, renderFetchedPage, fetchOutcome, describePageSubject, identifyReadBody);
      },
      parameters: $FetchArgs,
      retryable: true,
      supersedable: true,
      timeoutMs: FETCH_TIMEOUT_MS + PDF_READ_TIMEOUT_MS + 5_000,
      traceDetail: (args) => {
        const scope = args.wholePage ? ' (whole page)' : '';
        if (args.find !== undefined) {
          return `${args.url} find ${renderPhrases(args.find)}${scope}`;
        }
        const width = args.maxChars === undefined ? '' : ` for ${args.maxChars}`;
        const from = args.startChar === 0 ? '' : ` from ${args.startChar}`;
        return `${args.url}${from}${width}${scope}`;
      }
    },
    fill: {
      description: `${DESCRIPTION_PREAMBLE}Type into an input from the latest snapshot, replacing its current value — including signing in when the task calls for it. A drop-down list (a select) is chosen from with select instead.`,
      execute: async (args, context) => {
        return toSnapshotResult(
          await context.web.fill(context.turn.turnId, { pressEnter: args.pressEnter, ref: args.ref, text: args.text })
        );
      },
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
      parameters: z.object({
        ref: $Ref.describe('An element ref (shown as ⟨eN⟩) from the latest snapshot')
      }),
      supersedable: true,
      timeoutMs: WEB_TIMEOUT_MS,
      traceDetail: (args) => `⟨${args.ref}⟩`
    },
    navigate: {
      description:
        `${DESCRIPTION_PREAMBLE}Open a URL in this turn's page, replacing whatever it showed. ` +
        'A PDF or a text file is not opened here; read it with fetch.',
      execute: async (args, context) => {
        return toSnapshotResult(await context.web.navigate(context.turn.turnId, args.url), httpStatusOutcome);
      },
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
    },
    select: {
      description:
        `${DESCRIPTION_PREAMBLE}Choose an option in a drop-down list (a select) from the latest snapshot, which ` +
        "lists each select's options.",
      execute: async (args, context) => {
        return toSnapshotResult(await context.web.select(context.turn.turnId, { option: args.option, ref: args.ref }));
      },
      parameters: z.object({
        option: z
          .string()
          .min(1)
          .describe('The option to choose, by its label as the snapshot lists it, or by its value'),
        ref: $Ref.describe('The ref of the select, from the latest snapshot')
      }),
      supersedable: true,
      timeoutMs: WEB_TIMEOUT_MS,
      traceDetail: (args) => `⟨${args.ref}⟩ "${args.option}"`
    }
  }
});
