import { Tool } from '@collegium/core/tools';
import { Result } from '@collegium/core/utils';
import { Injectable } from '@nestjs/common';
import { match } from 'ts-pattern';
import { z } from 'zod';

import type { FormElement } from '@/web/snapshot/snapshot.types.ts';
import { BROWSER_TOOL_NAME } from '@/web/web.constants.ts';
import { WebService } from '@/web/web.service.ts';
import type { WebFailure, WebSnapshot } from '@/web/web.types.ts';

const REF_SHAPE = /^e\d+$/;

/**
 * `z.enum([...])` rather than `z.literal(...)` for the discriminators: it converts to `enum`, which
 * every provider accepts, where `literal` converts to `const`, which strict schema modes do not.
 */
type $BrowserArgs = z.infer<typeof $BrowserArgs>;
const $BrowserArgs = z.discriminatedUnion('action', [
  z.object({
    action: z.enum(['navigate']),
    url: z.url().describe("The absolute http(s) URL of a public web page, to open in this turn's page")
  }),
  z.object({
    action: z.enum(['click']),
    ref: z.string().regex(REF_SHAPE).describe('An element ref (shown as ⟨eN⟩) from the latest snapshot')
  }),
  z.object({
    action: z.enum(['fill']),
    pressEnter: z.boolean().optional().describe('Press Enter after typing, e.g. to run a search'),
    ref: z.string().regex(REF_SHAPE).describe('The ref of the input to fill, from the latest snapshot'),
    text: z.string().describe('The text to type, replacing the current value')
  })
]);

@Injectable()
export class BrowserTool extends Tool({
  description:
    'Browse the web in a real rendered browser (JavaScript runs). One page per turn: navigate opens or replaces it, ' +
    'click and fill act on ⟨eN⟩ refs from the latest snapshot, and every action returns a fresh snapshot of the page ' +
    'as markdown. Use it to read, to search, and to fill in and submit a form — including signing in — when the task ' +
    'calls for it.',
  name: BROWSER_TOOL_NAME,
  parameters: $BrowserArgs,
  // navigation is bounded at 30s and settle at 3s inside the session; this backstops a wedged browser
  timeoutMs: 45_000,
  // ungated as a read instrument (§3.4): the per-agent grant decides who browses, the status post traces every action
  variant: 'ungated'
}) {
  constructor(private readonly webService: WebService) {
    super();
  }

  async execute(args: $BrowserArgs, turn: Tool.TurnScope): Promise<Tool.Result> {
    const result = await match(args)
      .with({ action: 'navigate' }, ({ url }) => this.webService.navigate(turn.turnId, url))
      .with({ action: 'click' }, ({ ref }) => this.webService.click(turn.turnId, ref))
      .with({ action: 'fill' }, ({ pressEnter, ref, text }) =>
        this.webService.fill(turn.turnId, { pressEnter, ref, text })
      )
      .exhaustive();
    if (!result.success) {
      // the browser being down is infrastructure, not something the model can reason its way past
      if (result.error.kind === 'unreachable') {
        return Result.err({ kind: 'exception', message: result.error.message });
      }
      return Result.ok({ text: this.renderFailure(result.error) });
    }
    return Result.ok({ text: this.renderSnapshot(result.value) });
  }

  getApprovalRequirements(): Tool.ApprovalRequirements.Ungated {
    return { kind: 'ungated' };
  }

  /** a click may commit a side effect on the page; a timeout leaves us unable to say whether it landed (§7.2) */
  isRetryable(): false {
    return false;
  }

  renderTraceDetail(args: $BrowserArgs): string {
    return match(args)
      .with({ action: 'navigate' }, ({ url }) => `navigate ${url}`)
      .with({ action: 'click' }, ({ ref }) => `click ⟨${ref}⟩`)
      .with(
        { action: 'fill' },
        ({ pressEnter, ref, text }) => `fill ⟨${ref}⟩ with "${text}"${pressEnter === true ? ' then press "Enter"' : ''}`
      )
      .exhaustive();
  }

  private renderFailure(failure: Exclude<WebFailure, WebFailure.Unreachable>): string {
    return match(failure)
      .with({ kind: 'busy' }, () => 'the browser is at its concurrent-session limit; try again shortly')
      .with({ kind: 'empty-render' }, ({ url }) => `the page at ${url} rendered no readable content`)
      .with({ kind: 'navigation' }, ({ message }) => `the page could not be loaded: ${message}`)
      .with({ kind: 'no-session' }, () => 'no page is open in this turn — navigate to a URL first')
      .with(
        { kind: 'stale-ref' },
        ({ ref }) =>
          `⟨${ref}⟩ is not on the current page; the page has changed since that snapshot — use refs from the latest one`
      )
      .with({ kind: 'url-refused', reason: 'not-web-scheme' }, ({ url }) => `${url} is not an http or https page`)
      .with({ kind: 'url-refused', reason: 'not-public-host' }, ({ url }) => `${url} is not on the public web`)
      .exhaustive();
  }

  private renderFormElement(element: FormElement): string {
    const kind = element.kind === 'input' ? `input[type=${element.type}]` : element.kind;
    const label = element.label ? ` "${element.label}"` : '';
    const value = element.value ? ` = "${element.value}"` : '';
    return `- ⟨${element.ref}⟩ ${kind}${label}${value}`;
  }

  private renderSnapshot(snapshot: WebSnapshot): string {
    const header = `${snapshot.title} — ${snapshot.url} (HTTP ${snapshot.status})`;
    const controls = snapshot.formElements.map((element) => this.renderFormElement(element));
    const formBlock = controls.length > 0 ? `\n\nForm controls:\n${controls.join('\n')}` : '';
    return `${header}\n\n${snapshot.markdown}${formBlock}`;
  }
}
