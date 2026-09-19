import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

import { Result } from '@collegium/core/utils';

import { describeFetchError } from './fetch/fetch.utils.ts';

import type { AddressPolicy, VettedAddress, WebFailure } from './web.types.ts';

type Subnet = readonly [network: string, prefixLength: number];

const NON_PUBLIC_IPV4_SUBNETS = {
  linkLocal: ['169.254.0.0', 16],
  loopback: ['127.0.0.0', 8],
  multicast: ['224.0.0.0', 4],
  privateUse10: ['10.0.0.0', 8],
  privateUse172: ['172.16.0.0', 12],
  privateUse192: ['192.168.0.0', 16],
  reserved: ['240.0.0.0', 4],
  /** carrier-grade NAT, and the block Tailscale hands out */
  sharedAddressSpace: ['100.64.0.0', 10],
  thisNetwork: ['0.0.0.0', 8]
} as const satisfies { [key: string]: Subnet };

const NON_PUBLIC_IPV6_SUBNETS = {
  deprecatedIpv4Compatible: ['::', 96],
  deprecatedSixToFour: ['2002::', 16],
  linkLocal: ['fe80::', 10],
  /** RFC 8215: the operator picks where the IPv4 address sits (RFC 6052 §2.2), so what it carries cannot be read */
  localUseNat64: ['64:ff9b:1::', 48],
  loopback: ['::1', 128],
  multicast: ['ff00::', 8],
  uniqueLocal: ['fc00::', 7],
  unspecified: ['::', 128]
} as const satisfies { [key: string]: Subnet };

/** a DNS64 resolver answers every IPv4-only name inside it, so it is judged by the IPv4 address it carries */
const NAT64_WELL_KNOWN_PREFIX: Subnet = ['64:ff9b::', 96];

function buildNonPublicAddressList(): BlockList {
  const list = new BlockList();
  const [nat64Network, nat64PrefixLength] = NAT64_WELL_KNOWN_PREFIX;
  for (const [network, prefixLength] of Object.values(NON_PUBLIC_IPV4_SUBNETS)) {
    list.addSubnet(network, prefixLength, 'ipv4');
    list.addSubnet(`${nat64Network}${network}`, nat64PrefixLength + prefixLength, 'ipv6');
  }
  for (const [network, prefixLength] of Object.values(NON_PUBLIC_IPV6_SUBNETS)) {
    list.addSubnet(network, prefixLength, 'ipv6');
  }
  return list;
}

const NON_PUBLIC_ADDRESSES = buildNonPublicAddressList();

const WEB_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:']);

function stripBrackets(host: string): string {
  return host.replace(/^\[|]$/g, '').toLowerCase();
}

function isPrivateHostname(hostname: string): boolean {
  const host = stripBrackets(hostname);
  if (isIP(host) !== 0) {
    return isBlockedAddress(host);
  }
  return host === 'localhost' || host.endsWith('.localhost');
}

/** judged as a bare address: a literal written in a URL, or one answer from a lookup */
export function isBlockedAddress(address: string): boolean {
  const host = stripBrackets(address);
  return NON_PUBLIC_ADDRESSES.check(host, isIP(host) === 6 ? 'ipv6' : 'ipv4');
}

/**
 * §3.4 frames the browser as an instrument for reading the open web, and until this existed nothing
 * implemented that boundary: the tool is ungated, and unlike `shell` it runs as the orchestrator's
 * own OS user rather than inside the §A2 confinement. So a scheme that reads the filesystem, and a
 * host naming this machine or the network it sits on, are refused before any page is opened — a
 * typed refusal the model hears, like the non-HTML one.
 *
 * Hosts are judged as written, an address literal as an address and a name only by its name: this
 * bounds what may be *asked for*, cheaply and without a lookup. What a name resolves to is
 * `resolveAndVetHost`'s verdict, taken again for every request made.
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
