import type { WebFailure } from './web.types.ts';

/** loopback, the unspecified address, the link-local block cloud metadata answers on, and RFC 1918 */
const PRIVATE_IPV4_PATTERN = /^(?:0|10|127)\.|^169\.254\.|^192\.168\.|^172\.(?:1[6-9]|2\d|3[01])\./;

/** `::`, `::1`, unique-local `fc00::/7`, and link-local `fe80::/10`, as `URL` writes them */
const PRIVATE_IPV6_PATTERN = /^(?:::1?|f[cd][\da-f]*:|fe[89ab][\da-f]*:)/;

const WEB_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:']);

function isPrivateHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[|]$/g, '').toLowerCase();
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    PRIVATE_IPV4_PATTERN.test(host) ||
    PRIVATE_IPV6_PATTERN.test(host)
  );
}

/**
 * §3.4 frames the browser as an instrument for reading the open web, and until this existed nothing
 * implemented that boundary: the tool is ungated, and unlike `shell` it runs as the orchestrator's
 * own OS user rather than inside the §A2 confinement. So a scheme that reads the filesystem, and a
 * host naming this machine or the network it sits on, are refused before any page is opened — a
 * typed refusal the model hears, like the non-HTML one.
 *
 * Hosts are judged as written. A name that resolves to a private address is not caught here, and a
 * redirect is the browser's to follow; this bounds what may be *asked for*, not what DNS answers.
 */
export function refuseUnbrowsableUrl(url: string): undefined | WebFailure.UrlRefused {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { kind: 'url-refused', reason: 'not-web-scheme', url };
  }
  if (!WEB_PROTOCOLS.has(parsed.protocol)) {
    return { kind: 'url-refused', reason: 'not-web-scheme', url };
  }
  if (isPrivateHostname(parsed.hostname)) {
    return { kind: 'url-refused', reason: 'not-public-host', url };
  }
  return undefined;
}
