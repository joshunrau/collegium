import { Injectable } from '@nestjs/common';
import { Camoufox } from 'camoufox-js';
import type { Browser } from 'playwright-core';

/**
 * The launch seam, injected so the client's lifecycle logic (lazy launch, crash relaunch) stays
 * testable against a fake browser. The only file in the module that touches camoufox-js's
 * launcher, and the one place launch options live.
 */
@Injectable()
export class CamoufoxLauncher {
  launch(): Promise<Browser> {
    return Camoufox({
      // Firefox skips the proxy for loopback addresses unless told otherwise, and loopback is where
      // this host's own services listen — the one destination the policy proxy exists to refuse (§3.4)
      firefox_user_prefs: { 'network.proxy.allow_hijacking_localhost': true },
      headless: true
    });
  }
}
