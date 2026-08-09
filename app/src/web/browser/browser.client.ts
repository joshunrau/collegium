import { Result } from '@collegium/core/utils';
import { Injectable } from '@nestjs/common';

import { BrowserProcess } from './browser.process.ts';
import { BrowserSession } from './browser.session.ts';
import { isBrowserProvisioned } from './browser.utils.ts';

import type { WebFailure } from '../web.types.ts';

/**
 * The Camoufox seam: a fresh incognito context per session over the shared browser process. A
 * missing binary is refused before launch, because camoufox-js would otherwise start a
 * multi-minute download.
 */
@Injectable()
export class BrowserClient {
  constructor(private readonly browserProcess: BrowserProcess) {}

  async createSession(): Promise<Result<BrowserSession, WebFailure.Unreachable>> {
    if (!isBrowserProvisioned()) {
      return Result.err({
        kind: 'unreachable',
        message: 'the Camoufox browser is not provisioned — run `pnpm install` on the host'
      });
    }
    try {
      const browser = await this.browserProcess.acquire();
      const context = await browser.newContext();
      return Result.ok(new BrowserSession(context, await context.newPage()));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return Result.err({ kind: 'unreachable', message });
    }
  }

  async disposeAll(): Promise<void> {
    await this.browserProcess.dispose();
  }
}
