import { Result, toErrorMessage } from '@collegium/core/utils';
import type { BrowserContext, Locator, Page, Response } from 'playwright-core';

import { classifyContentType } from '../fetch/fetch.utils.ts';
import { lacksOption } from '../select/select.script.ts';
import { waitForDomSettled } from '../settle/settle.script.ts';
import { captureSnapshot } from '../snapshot/snapshot.script.ts';
import {
  ACTION_TIMEOUT_MS,
  DOM_QUIET_MS,
  DOM_SETTLE_MIN_MS,
  DOM_SETTLE_TIMEOUT_MS,
  NAVIGATION_TIMEOUT_MS,
  NETWORK_IDLE_TIMEOUT_MS,
  OPENED_TAB_URL_TIMEOUT_MS
} from '../web.constants.ts';
import { classifyActionError, classifyNavigationError } from './browser.utils.ts';

import type { RenderedCapture, WebFailure } from '../web.types.ts';

/** what can go wrong loading a page, whatever started the load */
type LoadFailure = WebFailure.Navigation | WebFailure.Tls | WebFailure.Unreachable;

/** what an action finds wrong with its element before it acts, so nothing was done */
type ActionRefusal = WebFailure.NoSuchOption;

/** and what can go wrong acting on a ref besides */
type ActionFailure =
  ActionRefusal | LoadFailure | WebFailure.ActionFailed | WebFailure.NotVisible | WebFailure.StaleRef;

/**
 * One live page and its ref numbering. The counter is held here — not in the page — so it
 * survives navigations: refs stay monotonic across the whole session, which is what guarantees a
 * stale ref can never alias onto a different element.
 */
export class BrowserSession {
  private lastStatus = 0;
  private nextRefIndex = 0;
  /** tabs this context opened on its own — a `target=_blank` link, a `window.open` — reported and closed by the next capture */
  private readonly opened: Page[] = [];
  private readonly page: Page;

  constructor(
    private readonly context: BrowserContext,
    page: Page
  ) {
    this.page = page;
    context.on('page', (popup) => {
      this.opened.push(popup);
    });
    page.on('response', (response) => {
      if (this.isMainFrameDocument(response)) {
        this.lastStatus = response.status();
      }
    });
  }

  async click(ref: string): Promise<Result<RenderedCapture, ActionFailure>> {
    return this.act(ref, (locator) => locator.click({ timeout: ACTION_TIMEOUT_MS }));
  }

  /** closing a context whose browser already died throws; disposal of the dead is a success */
  async dispose(): Promise<void> {
    try {
      await this.context.close();
    } catch {
      /* already gone */
    }
  }

  async fill(ref: string, text: string, pressEnter = false): Promise<Result<RenderedCapture, ActionFailure>> {
    return this.act(ref, async (locator) => {
      await locator.fill(text, { timeout: ACTION_TIMEOUT_MS });
      if (pressEnter) {
        await locator.press('Enter', { timeout: ACTION_TIMEOUT_MS });
      }
    });
  }

  async hover(ref: string): Promise<Result<RenderedCapture, ActionFailure>> {
    return this.act(ref, (locator) => locator.hover({ timeout: ACTION_TIMEOUT_MS }));
  }

  /** §3.4 — a PDF or a text file is web::fetch's to read, so the refusal names it; anything else neither tool reads */
  async navigate(
    url: string
  ): Promise<Result<RenderedCapture, LoadFailure | WebFailure.NotHtml | WebFailure.UnsupportedContent>> {
    try {
      const response = await this.page.goto(url, { timeout: NAVIGATION_TIMEOUT_MS, waitUntil: 'load' });
      const contentType = (await response?.headerValue('content-type')) ?? '';
      const kind = classifyContentType(contentType);
      if (kind === 'unsupported') {
        return Result.err({ contentType, kind: 'unsupported-content', url: response?.url() ?? url });
      }
      if (kind !== 'html') {
        return Result.err({ contentType, kind: 'not-html', url: response?.url() ?? url });
      }
    } catch (error) {
      return Result.err(this.asFailure(error));
    }
    return this.capture();
  }

  /** by the option's label or its value, as Playwright matches either */
  async select(ref: string, option: string): Promise<Result<RenderedCapture, ActionFailure>> {
    return this.act(ref, async (locator) => {
      if (await locator.evaluate(lacksOption, option)) {
        return { kind: 'no-such-option', option, ref };
      }
      await locator.selectOption(option, { timeout: ACTION_TIMEOUT_MS });
      return undefined;
    });
  }

  private async act(
    ref: string,
    action: (locator: Locator) => Promise<ActionRefusal | void>
  ): Promise<Result<RenderedCapture, ActionFailure>> {
    const locator = this.page.locator(`[data-collegium-ref="${ref}"]`);
    try {
      if ((await locator.count()) === 0) {
        return Result.err({ kind: 'stale-ref', ref });
      }
      const refused = await action(locator);
      if (refused) {
        return Result.err(refused);
      }
    } catch (error) {
      const message = toErrorMessage(error);
      if (this.isGone()) {
        return Result.err({ kind: 'unreachable', message });
      }
      // an action that timed out on a ref CSS hides is the one failure the model can act on itself,
      // so it must not arrive as an indistinguishable page failure
      if (await locator.isVisible().catch(() => true)) {
        return Result.err(classifyActionError(message, ref));
      }
      return Result.err({ kind: 'not-visible', ref });
    }
    return this.capture();
  }

  private asFailure(error: unknown): LoadFailure {
    const message = toErrorMessage(error);
    return this.isGone() ? { kind: 'unreachable', message } : classifyNavigationError(message);
  }

  private async capture(): Promise<Result<RenderedCapture, LoadFailure>> {
    try {
      await this.settle(this.page);
      const openedUrls = await this.closeOpenedTabs();
      const snapshot = await this.page.evaluate(captureSnapshot, this.nextRefIndex);
      this.nextRefIndex = snapshot.nextRefIndex;
      return Result.ok({
        formElements: snapshot.formElements,
        html: snapshot.html,
        openedUrls,
        status: this.lastStatus,
        title: await this.page.title(),
        url: this.page.url()
      });
    } catch (error) {
      return Result.err(this.asFailure(error));
    }
  }

  /**
   * A tab the page opened is never followed: the session stays on the page the model asked for,
   * and the tab's address is reported so the model can open it with navigate or fetch, where the
   * §3.4 URL policy judges it like any other. The wait is for the address alone — a popup's URL
   * is `about:blank` until its navigation commits — and is short, since the tab is closed either
   * way; one that never committed is reported as such.
   */
  private async closeOpenedTabs(): Promise<string[]> {
    const tabs = this.opened.splice(0);
    const urls: string[] = [];
    for (const tab of tabs) {
      await tab.waitForLoadState('domcontentloaded', { timeout: OPENED_TAB_URL_TIMEOUT_MS }).catch(() => undefined);
      urls.push(tab.url());
      await tab.close().catch(() => undefined);
    }
    return urls;
  }

  private isGone(): boolean {
    return this.page.isClosed() || this.context.browser()?.isConnected() === false;
  }

  /**
   * §3.4 — a snapshot reports the status of the document the page shows, which is not always the
   * one `goto` answered with: a bot check that clears itself, or a script that moves the page on,
   * loads another after it. A redirect is a hop on the way to a document, not one. This runs in an
   * event handler, where a throw would take the process down, so a frame Playwright cannot yet name
   * — one still being created, never the main one — is simply not it.
   */
  private isMainFrameDocument(response: Response): boolean {
    const request = response.request();
    const status = response.status();
    const isRedirect = status >= 300 && status < 400 && response.headers().location !== undefined;
    if (!request.isNavigationRequest() || isRedirect) {
      return false;
    }
    try {
      return request.frame() === this.page.mainFrame();
    } catch {
      return false;
    }
  }

  private async settle(page: Page): Promise<void> {
    await page.waitForLoadState('load', { timeout: NAVIGATION_TIMEOUT_MS });
    await page.waitForLoadState('networkidle', { timeout: NETWORK_IDLE_TIMEOUT_MS }).catch(() => undefined);
    // best-effort, like the idle wait above: a settle probe lost to a navigation is not a reason
    // to fail a capture that can still read the page
    await page
      .evaluate(waitForDomSettled, {
        minMs: DOM_SETTLE_MIN_MS,
        quietMs: DOM_QUIET_MS,
        timeoutMs: DOM_SETTLE_TIMEOUT_MS
      })
      .catch(() => undefined);
  }
}
