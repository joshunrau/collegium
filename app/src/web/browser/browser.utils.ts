import { camoufoxPath } from 'camoufox-js/dist/pkgman.js';

/**
 * Provisioning happens at install time. This check is what keeps a missing binary
 * from becoming a multi-minute download inside a tool call: camoufox-js downloads
 * on launch by default, so the client refuses to launch unless the binary is already on disk.
 */
export function isBrowserProvisioned(): boolean {
  try {
    camoufoxPath(false);
    return true;
  } catch {
    return false;
  }
}
