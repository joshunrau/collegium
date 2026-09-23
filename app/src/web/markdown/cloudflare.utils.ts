import type { TranslatorConfigFactory } from 'node-html-markdown';

type TranslatedElement = Parameters<TranslatorConfigFactory>[0]['node'];

const CLOUDFLARE_CIPHER = /^(?:[0-9a-f]{2}){2,}$/i;

/** what Cloudflare's decoder script looks for in a link's address, and what it rewrites to `mailto:` */
const CLOUDFLARE_LINK_MARKER = '/cdn-cgi/l/email-protection#';

/** the class Cloudflare's decoder script replaces with the address it decodes, whatever the element */
const CLOUDFLARE_CLOAK_CLASS = '__cf_email__';

const PLAUSIBLE_ADDRESS = /^[^\s@]+@[^\s@]+$/u;

const STRICT_UTF8 = new TextDecoder('utf-8', { fatal: true });

/**
 * Cloudflare's email cloak undone as its decoder script undoes it, so a fetch without script reads
 * the address a browser would (§3.4): the first byte is a key XORed into each byte after it, and
 * what that spells is UTF-8. Anything that does not come out as an address is refused rather than
 * guessed at — a wrong address copied into a record is the harm this exists to prevent.
 */
export function decodeCloudflareEmail(hex: string): string | undefined {
  if (!CLOUDFLARE_CIPHER.test(hex)) {
    return undefined;
  }
  const bytes = Uint8Array.from({ length: hex.length / 2 }, (_, index) => {
    return Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  });
  const key = bytes[0]!;
  let decoded: string;
  try {
    decoded = STRICT_UTF8.decode(bytes.subarray(1).map((byte) => byte ^ key));
  } catch {
    return undefined;
  }
  return PLAUSIBLE_ADDRESS.test(decoded) ? decoded : undefined;
}

/** an element Cloudflare cloaked, read as the address its script would have written in its place */
export function decodeCloakedElement(node: TranslatedElement): string | undefined {
  if (!node.classList.contains(CLOUDFLARE_CLOAK_CLASS)) {
    return undefined;
  }
  return decodeCloudflareEmail(node.getAttribute('data-cfemail') ?? '');
}

/** a link Cloudflare cloaked, read as the address its script would have rewritten it to `mailto:` */
export function decodeProtectedLink(href: string): string | undefined {
  const marker = href.indexOf(CLOUDFLARE_LINK_MARKER);
  return marker === -1 ? undefined : decodeCloudflareEmail(href.slice(marker + CLOUDFLARE_LINK_MARKER.length));
}
