import type { ToolResult } from '@collegium/core/tools';
import { implementToolset, WEB_TOOLSET_DEF } from '@collegium/core/toolsets';
import { Result } from '@collegium/core/utils';
import { z } from 'zod';

import { FETCH_TIMEOUT_MS } from './web.constants.ts';
import { WEB_SERVICE_TOKEN } from './web.tokens.ts';
import { renderWebFailure, renderWebPage, renderWebSnapshot } from './web.utils.ts';

import type { WebFailure, WebPage, WebSnapshot } from './web.types.ts';

const REF_SHAPE = /^e\d+$/;

/** navigation is bounded at 30s and settle at 3s inside the session; this backstops a wedged browser */
const WEB_TIMEOUT_MS = 45_000;

const $Ref = z.string().regex(REF_SHAPE);

const DESCRIPTION_PREAMBLE =
  'Browse the web in a real rendered browser (JavaScript runs). One page per turn, shared by the web tools; every ' +
  'action returns a fresh snapshot of the page as markdown with ⟨eN⟩ element refs. ';

/** the browser being down is infrastructure, not something the model can reason its way past */
function toPageResult<TPage extends WebPage>(
  result: Result<TPage, WebFailure>,
  render: (page: TPage) => string
): ToolResult {
  if (!result.success) {
    if (result.error.kind === 'unreachable') {
      return Result.err({ kind: 'exception', message: result.error.message });
    }
    return Result.ok({ text: renderWebFailure(result.error) });
  }
  return Result.ok({ text: render(result.value) });
}

const toSnapshotResult = (result: Result<WebSnapshot, WebFailure>): ToolResult => {
  return toPageResult(result, renderWebSnapshot);
};

/**
 * Ungated as a read instrument (§3.4): the per-agent grant decides who browses, the status post
 * traces every action. A click or fill may commit a side effect on the page, and even a navigation
 * can, so no browser tool is retryable: a timeout leaves us unable to say whether it landed (§7.2).
 * `fetch` is the exception — a scriptless GET commits nothing, so its timeout is a plain failure.
 */
export const WEB_TOOLSET = implementToolset(WEB_TOOLSET_DEF, {
  services: { web: WEB_SERVICE_TOKEN },
  tools: {
    click: {
      description: `${DESCRIPTION_PREAMBLE}Click an element from the latest snapshot, e.g. to follow a link or submit a form.`,
      execute: async (args, context) => toSnapshotResult(await context.web.click(context.turn.turnId, args.ref)),
      parameters: z.object({
        ref: $Ref.describe('An element ref (shown as ⟨eN⟩) from the latest snapshot')
      }),
      timeoutMs: WEB_TIMEOUT_MS,
      traceDetail: (args) => `⟨${args.ref}⟩`
    },
    fetch: {
      description:
        'Fetch a URL over plain HTTP and read it as markdown — no browser, no JavaScript, no session; ' +
        "this turn's browser page is untouched. Cheaper and faster than navigate: use it first for articles, " +
        'documentation, and static pages, and switch to navigate when the result says the page has no static content ' +
        'or when the task needs a click, a search, or a sign-in.',
      execute: async (args, context) => toPageResult(await context.web.fetch(args.url), renderWebPage),
      parameters: z.object({
        url: z.url().describe('The absolute http(s) URL of a public web page or text resource to fetch')
      }),
      retryable: true,
      timeoutMs: FETCH_TIMEOUT_MS + 5_000,
      traceDetail: (args) => args.url
    },
    fill: {
      description: `${DESCRIPTION_PREAMBLE}Type into an input from the latest snapshot, replacing its current value — including signing in when the task calls for it.`,
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
      timeoutMs: WEB_TIMEOUT_MS,
      /**
       * §3.4 — the line never shows what was typed. This tool may sign in, and the status post is a
       * channel post while the trace is readable by everyone who can approve, so fill text is the
       * one argument a supervisor must not be shown: masking it costs nothing a reviewer needs.
       */
      traceDetail: (args) =>
        `⟨${args.ref}⟩ with ${args.text.length} character(s)${args.pressEnter === true ? ' then press "Enter"' : ''}`
    },
    navigate: {
      description: `${DESCRIPTION_PREAMBLE}Open a URL in this turn's page, replacing whatever it showed.`,
      execute: async (args, context) => toSnapshotResult(await context.web.navigate(context.turn.turnId, args.url)),
      parameters: z.object({
        url: z.url().describe("The absolute http(s) URL of a public web page, to open in this turn's page")
      }),
      timeoutMs: WEB_TIMEOUT_MS,
      traceDetail: (args) => args.url
    }
  }
});
