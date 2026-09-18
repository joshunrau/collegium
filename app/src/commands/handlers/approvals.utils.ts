import type { PendingApproval } from '@/approvals/approvals.types.ts';
import { renderElapsed } from '@/formatting/durations/duration.utils.ts';

/** how many waiting approvals the listing names before it says how many more there are */
export const PENDING_LISTING_LIMIT = 20;

/** one row as the listing shows it, with the channel named where the roster still knows it */
export type PendingApprovalListing = PendingApproval & { readonly channelName: string | undefined };

/** §3.7 gives an approval no timeout, so the age is the whole point of the listing */
export function renderApprovalAge(requestedAt: Date, now: Date): string {
  return renderElapsed(now.getTime() - requestedAt.getTime());
}

/**
 * §8.4 — the listing is honest about its own scope: silence in the channels you are in is a
 * different fact from silence everywhere, and saying so names nothing that sits elsewhere.
 */
export function renderNothingWaiting(scope: 'anywhere' | 'your-channels'): string {
  return scope === 'anywhere'
    ? 'Nothing is waiting on a human.'
    : 'Nothing is waiting on a human in the channels you are in.';
}

/**
 * Oldest first, capped: an unbounded pending set would otherwise produce a post too large to
 * deliver, exactly when the listing is most worth having. A row whose prompt never posted names
 * no post, because there is none to open.
 */
export function renderPendingApprovals(rows: readonly PendingApprovalListing[], now: Date): string {
  const shown = rows.slice(0, PENDING_LISTING_LIMIT);
  const remainder = rows.length - shown.length;
  return [
    `${rows.length} approval(s) waiting on a human:`,
    ...shown.map((row) => {
      const where = row.channelName === undefined ? [] : [row.channelName];
      const prompt = row.promptPostId === null ? 'no prompt was posted' : `prompt \`${row.promptPostId}\``;
      return `· @${row.agentUsername} · \`${row.actionName}\` · ${renderApprovalAge(row.requestedAt, now)} · ${[...where, prompt].join(' · ')}`;
    }),
    ...(remainder > 0 ? [`…and ${remainder} more.`] : [])
  ].join('\n');
}
