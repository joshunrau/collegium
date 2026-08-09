import { Injectable } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';
import type { Browser } from 'playwright-core';

import { CamoufoxLauncher } from './browser.launcher.ts';

/**
 * Owns the one browser OS process: launched on first acquire, shared until it dies, relaunched
 * on the next acquire after a crash. The memoized promise is a single-flight guard — two racing
 * first acquires must not each launch a browser, since the loser would leak a Firefox process.
 */
@Injectable()
export class BrowserProcess implements OnApplicationShutdown {
  private handle: null | Promise<Browser> = null;

  constructor(private readonly launcher: CamoufoxLauncher) {}

  async acquire(): Promise<Browser> {
    let browser = await this.launchOnce();
    if (!browser.isConnected()) {
      this.handle = null;
      browser = await this.launchOnce();
    }
    return browser;
  }

  async dispose(): Promise<void> {
    const pending = this.handle;
    this.handle = null;
    if (pending) {
      try {
        await (await pending).close();
      } catch {
        /* already gone */
      }
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.dispose();
  }

  private async launchOnce(): Promise<Browser> {
    this.handle ??= this.launcher.launch();
    try {
      return await this.handle;
    } catch (error) {
      this.handle = null;
      throw error;
    }
  }
}
