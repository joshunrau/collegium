import { camoufoxPath } from 'camoufox-js/dist/pkgman.js';

import { NAVIGATION_TIMEOUT_MS } from '../web.constants.ts';

import type { TlsReason, WebFailure } from '../web.types.ts';

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

/** Firefox's names for a certificate that did not verify, by what each establishes (§3.4) */
const TLS_REASONS_BY_CODE: { readonly [code: string]: TlsReason } = {
  MOZILLA_PKIX_ERROR_SELF_SIGNED_CERT: 'self-signed',
  SEC_ERROR_EXPIRED_CERTIFICATE: 'expired',
  SEC_ERROR_EXPIRED_ISSUER_CERTIFICATE: 'expired',
  SEC_ERROR_UNKNOWN_ISSUER: 'untrusted-issuer',
  SEC_ERROR_UNTRUSTED_ISSUER: 'untrusted-issuer',
  SSL_ERROR_BAD_CERT_DOMAIN: 'name-mismatch'
};

/** the shape of every NSS and PSM security error's name; one not listed above is named but not classified */
const TLS_ERROR_CODE = /\b(?:MOZILLA_PKIX_ERROR|SEC_ERROR|SSL_ERROR)_[A-Z_]+\b/u;

function describeNavigationError(message: string): string {
  const code = Object.keys(NAVIGATION_ERRORS).find((known) => message.includes(known));
  return code === undefined ? message : NAVIGATION_ERRORS[code]!;
}

/**
 * A failed browser action in the app's words. Firefox refuses an unverifiable certificate with
 * `SEC_ERROR_UNKNOWN_ISSUER` whether the site left out its intermediates or this deployment lacks
 * the root, so that code is never read as the site's fault (§3.4).
 */
export function classifyNavigationError(message: string): WebFailure.Navigation | WebFailure.Tls {
  const code = TLS_ERROR_CODE.exec(message)?.[0];
  if (code === undefined) {
    return { kind: 'navigation', message: describeNavigationError(message) };
  }
  return { code, kind: 'tls', reason: TLS_REASONS_BY_CODE[code] ?? 'unclassified' };
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
