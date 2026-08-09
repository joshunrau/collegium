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

import type { RenderedCapture, WebFailure } from '../web.types.ts';

/**
 * One live page and its ref numbering. The counter is held here — not in the page — so it
 * survives navigations: refs stay monotonic across the whole session, which is what guarantees a
 * stale ref can never alias onto a different element.
 */
export class BrowserSession {
  private lastStatus = 0;
  private nextRefIndex = 0;

  constructor(
    private readonly context: BrowserContext,
    private readonly page: Page
  ) {}

  async click(
    ref: string
  ): Promise<Result<RenderedCapture, WebFailure.Navigation | WebFailure.StaleRef | WebFailure.Unreachable>> {
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
  ): Promise<Result<RenderedCapture, WebFailure.Navigation | WebFailure.StaleRef | WebFailure.Unreachable>> {
    return this.act(ref, async (locator) => {
      await locator.fill(text, { timeout: ACTION_TIMEOUT_MS });
      if (pressEnter) {
        await locator.press('Enter', { timeout: ACTION_TIMEOUT_MS });
      }
    });
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
    return this.capture();
  }

  private async act(
    ref: string,
    action: (locator: Locator) => Promise<void>
  ): Promise<Result<RenderedCapture, WebFailure.Navigation | WebFailure.StaleRef | WebFailure.Unreachable>> {
    try {
      const locator = this.page.locator(`[data-collegium-ref="${ref}"]`);
      if ((await locator.count()) === 0) {
        return Result.err({ kind: 'stale-ref', ref });
      }
      await action(locator);
    } catch (error) {
      return Result.err(this.asFailure(error));
    }
    return this.capture();
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
      await this.page.waitForLoadState('load', { timeout: NAVIGATION_TIMEOUT_MS });
      await this.page.waitForLoadState('networkidle', { timeout: NETWORK_IDLE_TIMEOUT_MS }).catch(() => undefined);
      // best-effort, like the idle wait above: a settle probe lost to a navigation is not a reason
      // to fail a capture that can still read the page
      await this.page
        .evaluate(waitForDomSettled, {
          minMs: DOM_SETTLE_MIN_MS,
          quietMs: DOM_QUIET_MS,
          timeoutMs: DOM_SETTLE_TIMEOUT_MS
        })
        .catch(() => undefined);
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
}
