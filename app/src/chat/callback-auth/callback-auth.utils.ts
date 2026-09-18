import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/** cannot appear in an approval id, an action name or a Mattermost username, so the parts encode unambiguously */
const PART_SEPARATOR = '\n';

/** §6.4 — an HMAC over one callback's identity: it verifies for no other, and forging one needs the key */
export function signCallback(secret: string, parts: readonly string[]): string {
  return createHmac('sha256', secret).update(parts.join(PART_SEPARATOR)).digest('hex');
}

/** compared as digests, so a length mismatch cannot throw and the comparison stays constant-time */
export function constantTimeEquals(left: string, right: string): boolean {
  return timingSafeEqual(createHash('sha256').update(left).digest(), createHash('sha256').update(right).digest());
}

export function verifyCallback(secret: string, parts: readonly string[], signature: string): boolean {
  return constantTimeEquals(signCallback(secret, parts), signature);
}
