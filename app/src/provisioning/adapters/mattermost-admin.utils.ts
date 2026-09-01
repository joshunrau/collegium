import { lookup } from 'node:dns/promises';

/** loopback, private, and link-local ranges — what Mattermost holds untrusted unless the host is listed */
const PRIVATE_IPV6 = /^(::1|f[cd][0-9a-f]{2}:|fe[89ab][0-9a-f]:)/i;

/** entries are hostnames, addresses, or `*.suffix` wildcards, matched against the host of the URL being called */
function isAllowed(host: string, allowed: readonly string[]): boolean {
  return allowed.some((entry) => entry === host || (entry.startsWith('*.') && host.endsWith(entry.slice(1))));
}

export function isPrivateAddress(address: string): boolean {
  const octets = address.split('.');
  if (octets.length === 4) {
    const [first = -1, second = -1] = octets.map(Number);
    return (
      first === 0 ||
      first === 10 ||
      first === 127 ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168)
    );
  }
  return PRIVATE_IPV6.test(address);
}

/**
 * Whether Mattermost would refuse to call the app back — the failure that otherwise surfaces as
 * `address forbidden` on the first approval button click, long after a boot that looked clean.
 * Mattermost consults its allow-list for a private or loopback address alone, so a public one needs
 * no entry; a host this process cannot resolve is left alone, because the server resolves it from a
 * network of its own and that view is the one that decides.
 */
export async function refusesCallbacks(params: { allowed: readonly string[]; publicUrl: string }): Promise<boolean> {
  const host = new URL(params.publicUrl).hostname.replace(/^\[|\]$/g, '');
  if (isAllowed(host, params.allowed)) {
    return false;
  }
  const address = await lookup(host)
    .then(({ address }) => address)
    .catch(() => undefined);
  return address !== undefined && isPrivateAddress(address);
}
