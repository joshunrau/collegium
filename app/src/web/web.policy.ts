import { lookup } from 'node:dns/promises';

import { Result } from '@collegium/core/utils';

import { describeFetchError } from './fetch/fetch.utils.ts';

import type { AddressPolicy, VettedAddress, WebFailure } from './web.types.ts';

/** loopback, the unspecified address, the link-local block cloud metadata answers on, and RFC 1918 */
const PRIVATE_IPV4_PATTERN = /^(?:0|10|127)\.|^169\.254\.|^192\.168\.|^172\.(?:1[6-9]|2\d|3[01])\./;

/** `::`, `::1`, unique-local `fc00::/7`, and link-local `fe80::/10`, as `URL` writes them */
const PRIVATE_IPV6_PATTERN = /^(?:::1?|f[cd][\da-f]*:|fe[89ab][\da-f]*:)/;

/** RFC 6598 shared address space, `100.64.0.0/10`: carrier-grade NAT, and the block Tailscale hands out */
const CGNAT_PATTERN = /^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./;

/** `224.0.0.0/4` */
const MULTICAST_PATTERN = /^(?:22[4-9]|23\d)\./;

/** `240.0.0.0/4`, the broadcast address included */
const RESERVED_PATTERN = /^(?:24\d|25[0-5])\./;

const BLOCKED_ADDRESS_PATTERNS = [
  PRIVATE_IPV4_PATTERN,
  PRIVATE_IPV6_PATTERN,
  CGNAT_PATTERN,
  MULTICAST_PATTERN,
  RESERVED_PATTERN
];

const WEB_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:']);

function stripBrackets(host: string): string {
  return host.replace(/^\[|]$/g, '').toLowerCase();
}

function isPrivateHostname(hostname: string): boolean {
  const host = stripBrackets(hostname);
  return host === 'localhost' || host.endsWith('.localhost') || isBlockedAddress(host);
}

/** judged as a bare address: a literal written in a URL, or one answer from a lookup */
export function isBlockedAddress(address: string): boolean {
  const host = stripBrackets(address);
  return BLOCKED_ADDRESS_PATTERNS.some((pattern) => pattern.test(host));
}

/**
 * §3.4 frames the browser as an instrument for reading the open web, and until this existed nothing
 * implemented that boundary: the tool is ungated, and unlike `shell` it runs as the orchestrator's
 * own OS user rather than inside the §A2 confinement. So a scheme that reads the filesystem, and a
 * host naming this machine or the network it sits on, are refused before any page is opened — a
 * typed refusal the model hears, like the non-HTML one.
 *
 * Hosts are judged as written: this bounds what may be *asked for*, cheaply and without a lookup.
 * What a name resolves to is `resolveAndVetHost`'s verdict, taken again for every request made.
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

/**
 * The resolved half of the §3.4 policy. Every answer for the name is judged, not only the first, so
 * a name carrying a public and a private record cannot pass on the lucky one; a literal address
 * resolves to itself. The address handed back is the one the caller connects to — `web::fetch`
 * pins its socket to it, so what the name resolves to a moment later changes nothing. A name that
 * does not resolve at all is the page failing to load, not an address off the public web.
 */
export async function resolveAndVetHost(
  url: URL
): Promise<Result<VettedAddress, WebFailure.Navigation | WebFailure.UrlRefused>> {
  let answers: { address: string; family: number }[];
  try {
    answers = await lookup(url.hostname, { all: true });
  } catch (error) {
    return Result.err({ kind: 'navigation', message: describeFetchError(error) });
  }
  const chosen = answers.find((answer) => answer.family === 4) ?? answers[0];
  if (chosen === undefined || answers.some((answer) => isBlockedAddress(answer.address))) {
    return Result.err({ kind: 'url-refused', reason: 'not-public-host', url: url.href });
  }
  return Result.ok({ address: chosen.address, family: chosen.family === 6 ? 6 : 4 });
}

/** both halves of the policy, as the browser's proxy applies them to every request it carries (§3.4) */
export const PRODUCTION_ADDRESS_POLICY: AddressPolicy = {
  vet: async (url) => {
    if (refuseUnbrowsableUrl(url.href) !== undefined) {
      return undefined;
    }
    const vetted = await resolveAndVetHost(url);
    return vetted.success ? vetted.value : undefined;
  }
};
