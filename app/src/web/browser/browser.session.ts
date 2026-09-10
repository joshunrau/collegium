import { Result } from '@collegium/core/utils';
import type { BrowserContext, Locator, Page } from 'playwright-core';

import { waitForDomSettled } from '../settle/settle.script.ts';
import { captureSnapshot } from '../snapshot/snapshot.script.ts';
import {
  ACTION_TIMEOUT_MS,
  DOM_QUIET_MS,
  DOM_SETTLE_MIN_MS,
  DOM_SETTLE_TIMEOUT_MS,
  NAVIGATION_TIMEOUT_MS,
  NETWORK_IDLE_TIMEOUT_MS
} from '../web.constants.ts';
import { refuseNonWebScheme } from '../web.policy.ts';

import type { RenderedCapture, WebFailure } from '../web.types.ts';

/**
 * One live page and its ref numbering. The counter is held here — not in the page — so it
 * survives navigations and the adoption below: refs stay monotonic across the whole session, which
 * is what guarantees a stale ref can never alias onto a different element.
 */
export class BrowserSession {
  private lastStatus = 0;
  private nextRefIndex = 0;
  /** pages this context opened on its own — a `target=_blank` link, a `window.open` */
  private readonly opened: Page[] = [];
  private page: Page;
  private readonly statusByOpenedPage = new WeakMap<Page, number>();

  constructor(
    private readonly context: BrowserContext,
    page: Page
  ) {
    this.page = page;
    context.on('page', (popup) => {
      this.opened.push(popup);
      popup.on('response', (response) => {
        if (response.request().isNavigationRequest() && response.frame() === popup.mainFrame()) {
          this.statusByOpenedPage.set(popup, response.status());
        }
      });
    });
  }

  async click(
    ref: string
  ): Promise<
    Result<
      RenderedCapture,
      WebFailure.Navigation | WebFailure.NotVisible | WebFailure.StaleRef | WebFailure.Unreachable
    >
  > {
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

  async fill(
    ref: string,
    text: string,
    pressEnter = false
  ): Promise<
    Result<
      RenderedCapture,
      WebFailure.Navigation | WebFailure.NotVisible | WebFailure.StaleRef | WebFailure.Unreachable
    >
  > {
    return this.act(ref, async (locator) => {
      await locator.fill(text, { timeout: ACTION_TIMEOUT_MS });
      if (pressEnter) {
        await locator.press('Enter', { timeout: ACTION_TIMEOUT_MS });
      }
    });
  }

  async hover(
    ref: string
  ): Promise<
    Result<
      RenderedCapture,
      WebFailure.Navigation | WebFailure.NotVisible | WebFailure.StaleRef | WebFailure.Unreachable
    >
  > {
    return this.act(ref, (locator) => locator.hover({ timeout: ACTION_TIMEOUT_MS }));
  }

  async navigate(url: string): Promise<Result<RenderedCapture, WebFailure.Navigation | WebFailure.Unreachable>> {
    try {
      const response = await this.page.goto(url, { timeout: NAVIGATION_TIMEOUT_MS, waitUntil: 'load' });
      const contentType = (await response?.headerValue('content-type')) ?? '';
      if (contentType && !contentType.includes('text/html')) {
        return Result.err({ kind: 'navigation', message: `not an HTML page: ${contentType}` });
      }
      this.lastStatus = response?.status() ?? this.lastStatus;
    } catch (error) {
      return Result.err(this.asFailure(error));
    }
    // a tab this navigation opened by itself is a popunder, not somewhere the model asked to be
    this.opened.length = 0;
    return this.capture();
  }

  private async act(
    ref: string,
    action: (locator: Locator) => Promise<void>
  ): Promise<
    Result<
      RenderedCapture,
      WebFailure.Navigation | WebFailure.NotVisible | WebFailure.StaleRef | WebFailure.Unreachable
    >
  > {
    const locator = this.page.locator(`[data-collegium-ref="${ref}"]`);
    try {
      if ((await locator.count()) === 0) {
        return Result.err({ kind: 'stale-ref', ref });
      }
      await action(locator);
    } catch (error) {
      // an action that timed out on a ref CSS hides is the one failure the model can act on itself,
      // so it must not arrive as an indistinguishable page failure
      if (await locator.isVisible().catch(() => true)) {
        return Result.err(this.asFailure(error));
      }
      return Result.err({ kind: 'not-visible', ref });
    }
    return this.capture();
  }

  /**
   * A click that opens a new tab leaves the model reading the page it clicked away from — the
   * content it asked for is in a tab this seam cannot see. The newest tab becomes the session's
   * page instead, which is where a person would be looking.
   *
   * Which host such a tab names is the page's business, as a redirect target is — §3.4's host rule
   * bounds what the model may ask for, and this address it never asked for. The scheme is still
   * judged, because leaving the web is not something a redirect can do either. A tab that is
   * refused, or that never loaded, is closed and the session stays where it was.
   *
   * Called from `capture` rather than from the action, because the `page` event arrives a tick
   * after the click resolves — by the time the settle waits below have run, it is here.
   */
  private async adoptOpenedPage(): Promise<boolean> {
    const candidate = this.opened.splice(0).at(-1);
    if (!candidate) {
      return false;
    }
    await candidate.waitForLoadState('domcontentloaded', { timeout: NAVIGATION_TIMEOUT_MS }).catch(() => undefined);
    const url = candidate.url();
    if (url === 'about:blank' || refuseNonWebScheme(url) !== undefined) {
      await candidate.close().catch(() => undefined);
      return false;
    }
    this.page = candidate;
    this.lastStatus = this.statusByOpenedPage.get(candidate) ?? this.lastStatus;
    return true;
  }

  private asFailure(error: unknown): WebFailure.Navigation | WebFailure.Unreachable {
    const message = error instanceof Error ? error.message : String(error);
    if (this.page.isClosed() || this.context.browser()?.isConnected() === false) {
      return { kind: 'unreachable', message };
    }
    return { kind: 'navigation', message };
  }

  private async capture(): Promise<Result<RenderedCapture, WebFailure.Navigation | WebFailure.Unreachable>> {
    try {
      await this.settle(this.page);
      // only a tab that was actually adopted pays for a second settle
      if (await this.adoptOpenedPage()) {
        await this.settle(this.page);
      }
      const snapshot = await this.page.evaluate(captureSnapshot, this.nextRefIndex);
      this.nextRefIndex = snapshot.nextRefIndex;
      return Result.ok({
        formElements: snapshot.formElements,
        html: snapshot.html,
        status: this.lastStatus,
        title: await this.page.title(),
        url: this.page.url()
      });
    } catch (error) {
      return Result.err(this.asFailure(error));
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
