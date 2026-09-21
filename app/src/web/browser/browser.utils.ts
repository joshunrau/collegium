import { camoufoxPath } from 'camoufox-js/dist/pkgman.js';

import { NAVIGATION_TIMEOUT_MS } from '../web.constants.ts';

/**
 * Firefox's transport errors in the app's words, since `NS_ERROR_NET_EMPTY_RESPONSE` reached a
 * model as a fact about the server. The empty response names both causes because the policy proxy
 * (§3.4) refuses an address the same way a dead host does, and nothing downstream can tell them apart.
 */
const NAVIGATION_ERRORS: { readonly [code: string]: string } = {
  NS_ERROR_CONNECTION_REFUSED: 'the connection was refused',
  NS_ERROR_NET_EMPTY_RESPONSE:
    "the connection was accepted and closed with no response: the host, or this deployment's URL policy, refused it",
  NS_ERROR_NET_TIMEOUT: `the page did not answer within ${NAVIGATION_TIMEOUT_MS / 1000}s`,
  NS_ERROR_UNKNOWN_HOST: 'the host name does not resolve'
};

export function describeNavigationError(message: string): string {
  const code = Object.keys(NAVIGATION_ERRORS).find((known) => message.includes(known));
  return code === undefined ? message : NAVIGATION_ERRORS[code]!;
}

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
