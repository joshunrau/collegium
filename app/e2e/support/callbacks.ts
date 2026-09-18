import { createHmac } from 'node:crypto';

import { E2E_CALLBACK_TOKEN } from './env.ts';

/**
 * What a genuine Mattermost callback carries for one approval: the signature the app minted into
 * the button's context (§6.4). Mirrors the app's own algorithm so a test can play Mattermost's
 * part; drift between the two shows up as every direct decision being refused.
 */
export function signDecision(approvalId: string, action: 'approve' | 'deny' | 'deny-with-reason'): string {
  return createHmac('sha256', E2E_CALLBACK_TOKEN).update(['decision', approvalId, action].join('\n')).digest('hex');
}
