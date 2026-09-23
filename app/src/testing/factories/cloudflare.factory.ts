/** Cloudflare's cloak as its edge writes it: a key byte, then each byte of the address XORed with that key */
export function cloakEmail(address: string, key = 0x5a): string {
  return [key, ...new TextEncoder().encode(address).map((byte) => byte ^ key)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
