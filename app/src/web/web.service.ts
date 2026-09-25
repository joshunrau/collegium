import { Result } from '@collegium/core/utils';
import { Inject, Injectable } from '@nestjs/common';

import { ConfigService } from '@/config/config.service.ts';
import { LoggingService } from '@/logging/logging.service.ts';

import { BrowserClient } from './browser/browser.client.ts';
import { FetchClient } from './fetch/fetch.client.ts';
import { extractTitle } from './fetch/fetch.utils.ts';
import { stripPageChrome } from './fetch/page-chrome.utils.ts';
import { refuseUnreadablePage } from './fetch/readability.utils.ts';
import { pageToMarkdown } from './markdown/markdown.utils.ts';
import { PdfTextExtractor } from './pdf/pdf-text.extractor.ts';
import { createPdfReadBudget, isWithoutTextLayer, readPdfText } from './pdf/pdf.utils.ts';
import { capMarkdown, readPage } from './reading/reading.utils.ts';
import { measureUnchangedPrefix } from './snapshot/snapshot.utils.ts';
import { SNAPSHOT_VIEW_CHARS } from './web.constants.ts';
import { ADDRESS_POLICY_TOKEN } from './web.tokens.ts';

import type { BrowserSession } from './browser/browser.session.ts';
import type { FetchedPdf } from './fetch/fetch.types.ts';
import type {
  AddressPolicy,
  FetchedPage,
  PageRead,
  PageView,
  RenderedCapture,
  WebFailure,
  WebSnapshot
} from './web.types.ts';

/**
 * The web seam: turn-scoped browsing sessions, one page each, driven by refs the model read in
 * the previous snapshot. All of the module's sophistication lives here and below, so the tool
 * that calls it stays trivial (§6.1).
 *
 * An HTTP error is not a failure — a 404 is a page with content and a status, and the model
 * reasons about it, exactly as `shell` hands back a non-zero exit as `ok`. `Result.err` is
 * reserved for having nothing to say about the page at all, which a site's refusal to serve it
 * is too: its body describes the refusal, never the page.
 */
@Injectable()
export class WebService {
  private readonly maxSessions: number;

  /** §3.4 — each turn's last snapshot of its page, so the next can say where a growing page changed */
  private readonly previousCaptures = new Map<string, string>();

  /**
   * The slot is the promise, not the session: it is claimed before the browser launches, so a turn
   * ending mid-launch still finds something to dispose (§5.1's lock is not held across a tool call).
   */
  private readonly sessions = new Map<string, Promise<Result<BrowserSession, WebFailure.Unreachable>>>();

  constructor(
    @Inject(ADDRESS_POLICY_TOKEN) private readonly addressPolicy: AddressPolicy,
    private readonly browserClient: BrowserClient,
    configService: ConfigService,
    private readonly fetchClient: FetchClient,
    private readonly loggingService: LoggingService,
    private readonly pdfTextExtractor: PdfTextExtractor
  ) {
    this.maxSessions = configService.get('web.maxBrowserSessions');
  }

  async click(turnId: string, ref: string): Promise<Result<WebSnapshot, Exclude<WebFailure, WebFailure.Busy>>> {
    const opened = await this.sessions.get(turnId);
    if (!opened?.success) {
      return Result.err({ kind: 'no-session' });
    }
    return this.toSnapshot(turnId, await opened.value.click(ref));
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
    this.previousCaptures.delete(turnId);
    const opened = await opening;
    if (opened?.success) {
      await opened.value.dispose();
    }
  }

  /**
   * No session and no slot: one GET, converted by the same rules a rendered page is, and read as
   * the call asked. A page that cannot be read this way is refused, never rendered in its place —
   * whether a browser is worth its slot is the model's call (§3.4).
   */
  async fetch(
    url: string,
    read: PageRead
  ): Promise<
    Result<
      FetchedPage,
      | WebFailure.Blocked
      | WebFailure.EmptyBody
      | WebFailure.HttpError
      | WebFailure.Navigation
      | WebFailure.NoStaticContent
      | WebFailure.NoText
      | WebFailure.Tls
      | WebFailure.UnreadablePdf
      | WebFailure.UnsupportedContent
      | WebFailure.UrlRefused
    >
  > {
    const fetched = await this.fetchClient.get(url);
    if (!fetched.success) {
      return fetched;
    }
    if (fetched.value.kind === 'pdf') {
      return this.readPdf(fetched.value, read);
    }
    const { body, kind, retry, status, url: finalUrl } = fetched.value;
    const answered = { status, url: finalUrl, ...(retry && { retry }) };
    if (kind === 'text') {
      return Result.ok({
        ...readPage({ leftOutChars: 0, markdown: body }, read),
        ...answered,
        title: new URL(finalUrl).pathname
      });
    }
    const markdown = pageToMarkdown(body, finalUrl, 'labelled');
    const title = extractTitle(body);
    const unreadable = refuseUnreadablePage({ ...answered, body, markdown, title });
    if (unreadable) {
      return Result.err(unreadable);
    }
    const view = read.wholePage ? { leftOutChars: 0, markdown } : this.viewMainContent(body, finalUrl, markdown);
    return Result.ok({ ...readPage(view, read), ...answered, title });
  }

  async fill(
    turnId: string,
    args: { pressEnter?: boolean; ref: string; text: string }
  ): Promise<Result<WebSnapshot, Exclude<WebFailure, WebFailure.Busy>>> {
    const opened = await this.sessions.get(turnId);
    if (!opened?.success) {
      return Result.err({ kind: 'no-session' });
    }
    return this.toSnapshot(turnId, await opened.value.fill(args.ref, args.text, args.pressEnter ?? false));
  }

  async hover(turnId: string, ref: string): Promise<Result<WebSnapshot, Exclude<WebFailure, WebFailure.Busy>>> {
    const opened = await this.sessions.get(turnId);
    if (!opened?.success) {
      return Result.err({ kind: 'no-session' });
    }
    return this.toSnapshot(turnId, await opened.value.hover(ref));
  }

  /** the only action that opens a session — click and fill before any navigate are `no-session` */
  async navigate(turnId: string, url: string): Promise<Result<WebSnapshot, Exclude<WebFailure, WebFailure.NoSession>>> {
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
    // to dispose, not claim one afterwards. The session would report the proxy's refusal the same
    // way, but only after a load that could not succeed
    const vetted = await this.addressPolicy.resolve(new URL(url));
    if (!vetted.success) {
      return vetted;
    }
    return this.toSnapshot(turnId, await opened.value.navigate(url));
  }

  async select(
    turnId: string,
    args: { option: string; ref: string }
  ): Promise<Result<WebSnapshot, Exclude<WebFailure, WebFailure.Busy>>> {
    const opened = await this.sessions.get(turnId);
    if (!opened?.success) {
      return Result.err({ kind: 'no-session' });
    }
    return this.toSnapshot(turnId, await opened.value.select(args.ref, args.option));
  }

  /**
   * Claiming the slot is synchronous — the map is written before the launch is awaited — which makes
   * the cap a compare-and-swap rather than a check-then-act: concurrent first-navigates in different
   * turns can no longer all pass a size read that is already stale. A turn past the cap is refused,
   * never queued (§3.4).
   */
  private async openSession(turnId: string): Promise<Result<BrowserSession, WebFailure.Busy | WebFailure.Unreachable>> {
    const existing = this.sessions.get(turnId);
    if (existing) {
      return existing;
    }
    if (this.sessions.size >= this.maxSessions) {
      this.loggingService.warn(
        `turn ${turnId} was refused a browser session: all ${this.maxSessions} are held, by turns ${[...this.sessions.keys()].join(', ')}`
      );
      return Result.err({ kind: 'busy', sessions: this.maxSessions });
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

  /** §3.4 — the text layer alone, under the same windowing as a page; a cut PDF does not parse, so it is not read */
  private async readPdf(
    { bytes, isTruncated, retry, status, url }: FetchedPdf,
    read: PageRead
  ): Promise<Result<FetchedPage, WebFailure.NoText | WebFailure.UnreadablePdf>> {
    if (isTruncated) {
      return Result.err({ kind: 'unreadable-pdf', reason: 'too-large', url });
    }
    const extracted = await this.pdfTextExtractor.extract(bytes, createPdfReadBudget());
    if (!extracted.success) {
      return Result.err({ kind: 'unreadable-pdf', reason: extracted.error, url });
    }
    const text = extracted.value;
    if (isWithoutTextLayer(text)) {
      return Result.err({ kind: 'no-text', pageCount: text.pageCount, url });
    }
    return Result.ok({
      ...readPdfText(text, read),
      status,
      title: new URL(url).pathname,
      url,
      ...(retry && { retry })
    });
  }

  private toSnapshot<TFailure extends WebFailure>(
    turnId: string,
    rendered: Result<RenderedCapture, TFailure>
  ): Result<WebSnapshot, TFailure | WebFailure.EmptyRender> {
    if (!rendered.success) {
      return rendered;
    }
    const { formElements, html, openedUrls, staleRef, status, title, url } = rendered.value;
    const capped = capMarkdown(pageToMarkdown(html, url, 'counted'));
    // a page that rendered nothing is indistinguishable from a page with nothing on it, and the
    // model cannot tell them apart — so it is never returned as content
    if (!capped.markdown) {
      return Result.err({ kind: 'empty-render', status, url });
    }
    const previous = this.previousCaptures.get(turnId);
    this.previousCaptures.set(turnId, capped.markdown);
    const unchanged = previous === undefined ? 0 : measureUnchangedPrefix(previous, capped.markdown);
    return Result.ok({
      ...capped,
      formElements,
      openedUrls,
      ...(staleRef !== undefined && { staleRef }),
      status,
      title,
      ...(unchanged > SNAPSHOT_VIEW_CHARS && { unchangedPrefixChars: unchanged }),
      url
    });
  }

  /**
   * §3.4 — the page less its chrome, converted by the same rules. A page whose main content is
   * empty without script, or whose chrome is all there is, is read whole: leaving the chrome out
   * would leave nothing.
   */
  private viewMainContent(html: string, pageUrl: string, whole: string): PageView {
    const stripped = stripPageChrome(html);
    const main = stripped === undefined ? '' : pageToMarkdown(stripped, pageUrl, 'labelled');
    return main === ''
      ? { leftOutChars: 0, markdown: whole }
      : { leftOutChars: whole.length - main.length, markdown: main };
  }
}
