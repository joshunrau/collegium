import { Result } from '@collegium/core/utils';
import { Injectable } from '@nestjs/common';

import { BrowserClient } from './browser/browser.client.ts';
import { MAX_LIVE_SESSIONS } from './web.constants.ts';
import { refuseUnbrowsableUrl } from './web.policy.ts';
import { capMarkdown, toMarkdown } from './web.utils.ts';

import type { BrowserSession } from './browser/browser.session.ts';
import type { RenderedCapture, WebFailure, WebSnapshot } from './web.types.ts';

/**
 * The web seam: turn-scoped browsing sessions, one page each, driven by refs the model read in
 * the previous snapshot. All of the module's sophistication lives here and below, so the tool
 * that calls it stays trivial (§6.1).
 *
 * An HTTP error is not a failure — a 404 is a page with content and a status, and the model
 * reasons about it, exactly as `shell` hands back a non-zero exit as `ok`. `Result.err` is
 * reserved for having nothing to say about the page at all.
 */
@Injectable()
export class WebService {
  private readonly sessions = new Map<string, BrowserSession>();

  constructor(private readonly browserClient: BrowserClient) {}

  async click(
    turnId: string,
    ref: string
  ): Promise<Result<WebSnapshot, Exclude<WebFailure, WebFailure.Busy | WebFailure.UrlRefused>>> {
    const session = this.sessions.get(turnId);
    if (!session) {
      return Result.err({ kind: 'no-session' });
    }
    return this.toSnapshot(await session.click(ref));
  }

  /** guaranteed-once at turn end: the turn engine calls this on every path out of a turn */
  async endTurn(turnId: string): Promise<void> {
    const session = this.sessions.get(turnId);
    this.sessions.delete(turnId);
    await session?.dispose();
  }

  async fill(
    turnId: string,
    args: { pressEnter?: boolean; ref: string; text: string }
  ): Promise<Result<WebSnapshot, Exclude<WebFailure, WebFailure.Busy | WebFailure.UrlRefused>>> {
    const session = this.sessions.get(turnId);
    if (!session) {
      return Result.err({ kind: 'no-session' });
    }
    return this.toSnapshot(await session.fill(args.ref, args.text, args.pressEnter ?? false));
  }

  /** the only action that opens a session — click and fill before any navigate are `no-session` */
  async navigate(
    turnId: string,
    url: string
  ): Promise<Result<WebSnapshot, Exclude<WebFailure, WebFailure.NoSession | WebFailure.StaleRef>>> {
    // before the session, not inside it: a refused address must cost neither a browser launch nor
    // one of the live-session slots §3.4's cap hands out
    const refused = refuseUnbrowsableUrl(url);
    if (refused) {
      return Result.err(refused);
    }
    const existing = this.sessions.get(turnId);
    if (existing) {
      return this.toSnapshot(await existing.navigate(url));
    }
    if (this.sessions.size >= MAX_LIVE_SESSIONS) {
      return Result.err({ kind: 'busy' });
    }
    const created = await this.browserClient.createSession();
    if (!created.success) {
      return created;
    }
    this.sessions.set(turnId, created.value);
    return this.toSnapshot(await created.value.navigate(url));
  }

  private toSnapshot<TFailure extends WebFailure>(
    rendered: Result<RenderedCapture, TFailure>
  ): Result<WebSnapshot, TFailure | WebFailure.EmptyRender> {
    if (!rendered.success) {
      return rendered;
    }
    const markdown = capMarkdown(toMarkdown(rendered.value.html));
    // a page that rendered nothing is indistinguishable from a page with nothing on it, and the
    // model cannot tell them apart — so it is never returned as content
    if (!markdown) {
      return Result.err({ kind: 'empty-render', url: rendered.value.url });
    }
    return Result.ok({
      formElements: rendered.value.formElements,
      markdown,
      status: rendered.value.status,
      title: rendered.value.title,
      url: rendered.value.url
    });
  }
}
