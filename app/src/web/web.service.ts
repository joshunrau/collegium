import { Result } from '@collegium/core/utils';
import { Inject, Injectable } from '@nestjs/common';

import { BrowserClient } from './browser/browser.client.ts';
import { FetchClient } from './fetch/fetch.client.ts';
import { extractTitle, needsClientRendering } from './fetch/fetch.utils.ts';
import { MAX_LIVE_SESSIONS } from './web.constants.ts';
import { ADDRESS_POLICY_TOKEN } from './web.tokens.ts';
import { capMarkdown, toMarkdown, windowMarkdown } from './web.utils.ts';

import type { BrowserSession } from './browser/browser.session.ts';
import type { AddressPolicy, RenderedCapture, WebFailure, WebPage, WebSnapshot } from './web.types.ts';

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
  /**
   * The slot is the promise, not the session: it is claimed before the browser launches, so a turn
   * ending mid-launch still finds something to dispose (§5.1's lock is not held across a tool call).
   */
  private readonly sessions = new Map<string, Promise<Result<BrowserSession, WebFailure.Unreachable>>>();

  constructor(
    @Inject(ADDRESS_POLICY_TOKEN) private readonly addressPolicy: AddressPolicy,
    private readonly browserClient: BrowserClient,
    private readonly fetchClient: FetchClient
  ) {}

  async click(
    turnId: string,
    ref: string
  ): Promise<Result<WebSnapshot, Exclude<WebFailure, WebFailure.Busy | WebFailure.UrlRefused>>> {
    const opened = await this.sessions.get(turnId);
    if (!opened?.success) {
      return Result.err({ kind: 'no-session' });
    }
    return this.toSnapshot(await opened.value.click(ref));
  }

  /**
   * Guaranteed-once at turn end: the turn engine calls this on every path out of a turn, including
   * the ones that abandon an in-flight `navigate` — a tool timeout, a `/kill`. Awaiting the claim
   * rather than reading a session out of the map is what makes that safe: the launch it abandoned
   * still resolves, and whatever it produces is disposed here rather than held until restart.
   */
  async endTurn(turnId: string): Promise<void> {
    const opening = this.sessions.get(turnId);
    this.sessions.delete(turnId);
    const opened = await opening;
    if (opened?.success) {
      await opened.value.dispose();
    }
  }

  /** no session and no slot: one GET, converted by the same rules a rendered page is, read from `startChar` on (§3.8) */
  async fetch(
    url: string,
    startChar = 0
  ): Promise<
    Result<
      WebPage,
      | WebFailure.HttpError
      | WebFailure.Navigation
      | WebFailure.NoStaticContent
      | WebFailure.UnsupportedContent
      | WebFailure.UrlRefused
    >
  > {
    const fetched = await this.fetchClient.get(url);
    if (!fetched.success) {
      return fetched;
    }
    const { body, kind, status, url: finalUrl } = fetched.value;
    if (kind === 'text') {
      return Result.ok({
        ...windowMarkdown(body, startChar),
        status,
        title: new URL(finalUrl).pathname,
        url: finalUrl
      });
    }
    const markdown = toMarkdown(body, finalUrl);
    if (needsClientRendering(markdown)) {
      // an error status with nothing readable is a page that is not there; a browser will not find one either
      return status >= 400
        ? Result.err({ bodyChars: body.length, kind: 'http-error', status, url: finalUrl })
        : Result.err({ kind: 'no-static-content', status, url: finalUrl });
    }
    return Result.ok({ ...windowMarkdown(markdown, startChar), status, title: extractTitle(body), url: finalUrl });
  }

  async fill(
    turnId: string,
    args: { pressEnter?: boolean; ref: string; text: string }
  ): Promise<Result<WebSnapshot, Exclude<WebFailure, WebFailure.Busy | WebFailure.UrlRefused>>> {
    const opened = await this.sessions.get(turnId);
    if (!opened?.success) {
      return Result.err({ kind: 'no-session' });
    }
    return this.toSnapshot(await opened.value.fill(args.ref, args.text, args.pressEnter ?? false));
  }

  async hover(
    turnId: string,
    ref: string
  ): Promise<Result<WebSnapshot, Exclude<WebFailure, WebFailure.Busy | WebFailure.UrlRefused>>> {
    const opened = await this.sessions.get(turnId);
    if (!opened?.success) {
      return Result.err({ kind: 'no-session' });
    }
    return this.toSnapshot(await opened.value.hover(ref));
  }

  /** the only action that opens a session — click and fill before any navigate are `no-session` */
  async navigate(
    turnId: string,
    url: string
  ): Promise<Result<WebSnapshot, Exclude<WebFailure, WebFailure.NoSession | WebFailure.StaleRef>>> {
    // before the session, not inside it: a refused address must cost neither a browser launch nor
    // one of the live-session slots §3.4's cap hands out
    const refused = this.addressPolicy.refuse(url);
    if (refused) {
      return Result.err(refused);
    }
    const opened = await this.openSession(turnId);
    if (!opened.success) {
      return opened;
    }
    // after the slot is claimed, never before: a turn ending during the lookup must find a session
    // to dispose, not claim one afterwards. The proxy would refuse the address too, but as a page
    // that failed to load, where this is the typed refusal it is
    const vetted = await this.addressPolicy.resolve(new URL(url));
    if (!vetted.success) {
      return vetted;
    }
    return this.toSnapshot(await opened.value.navigate(url));
  }

  /**
   * Claiming the slot is synchronous — the map is written before the launch is awaited — which makes
   * the cap a compare-and-swap rather than a check-then-act: concurrent first-navigates in different
   * turns can no longer all pass a size read that is already stale.
   */
  private async openSession(turnId: string): Promise<Result<BrowserSession, WebFailure.Busy | WebFailure.Unreachable>> {
    const existing = this.sessions.get(turnId);
    if (existing) {
      return existing;
    }
    if (this.sessions.size >= MAX_LIVE_SESSIONS) {
      return Result.err({ kind: 'busy' });
    }
    const opening = this.browserClient.createSession();
    this.sessions.set(turnId, opening);
    const opened = await opening;
    if (!opened.success) {
      // a launch that produced no session holds no slot, and memoizing the failure would sink the
      // rest of the turn's browsing with it
      this.sessions.delete(turnId);
    }
    return opened;
  }

  private toSnapshot<TFailure extends WebFailure>(
    rendered: Result<RenderedCapture, TFailure>
  ): Result<WebSnapshot, TFailure | WebFailure.EmptyRender> {
    if (!rendered.success) {
      return rendered;
    }
    const capped = capMarkdown(toMarkdown(rendered.value.html, rendered.value.url));
    // a page that rendered nothing is indistinguishable from a page with nothing on it, and the
    // model cannot tell them apart — so it is never returned as content
    if (!capped.markdown) {
      return Result.err({ kind: 'empty-render', status: rendered.value.status, url: rendered.value.url });
    }
    return Result.ok({
      ...capped,
      formElements: rendered.value.formElements,
      openedUrls: rendered.value.openedUrls,
      status: rendered.value.status,
      title: rendered.value.title,
      url: rendered.value.url
    });
  }
}
