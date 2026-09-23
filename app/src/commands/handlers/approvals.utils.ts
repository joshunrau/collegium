import { DECISION_GLYPHS } from '@/approvals/approvals.constants.ts';
import type { PendingDecision } from '@/approvals/decisions/decisions.types.ts';
import { renderElapsed } from '@/formatting/durations/duration.utils.ts';

/** §3.7a — a question is model prose of up to 2000 characters; one line shows its head */
const QUESTION_HEAD_LIMIT_CHARS = 80;

function renderPendingCounts(rows: readonly PendingDecisionListing[]): string {
  const questions = rows.filter((row) => row.kind === 'ask').length;
  const approvals = rows.length - questions;
  return [
    ...(approvals > 0 ? [`${approvals} approval(s)`] : []),
    ...(questions > 0 ? [`${questions} question(s)`] : [])
  ].join(' and ');
}

/** a decision whose prompt never posted names no post, because there is none to open */
function renderPromptReference(decision: PendingDecision): string {
  return decision.promptPostId === null ? 'no prompt was posted' : `prompt \`${decision.promptPostId}\``;
}

/** how many waiting decisions the listing names before it says how many more there are */
export const PENDING_LISTING_LIMIT = 20;

/** §8.1 — a decision a turn is parked on, and since when in the operator timezone */
export type ParkedDecision = {
  readonly decision: PendingDecision;
  readonly since: string;
};

/** one row as the listing shows it, with the channel named where the roster still knows it */
export type PendingDecisionListing = PendingDecision & { readonly channelName: string | undefined };

/** §3.7 gives a decision no timeout, so its age is the whole point of a listing */
export function renderPendingAge(requestedAt: Date, now: Date): string {
  return renderElapsed(now.getTime() - requestedAt.getTime());
}

/** §8.4 — one answer whether nothing is pending or it all sits elsewhere, so the listing hints at nothing the invoker cannot see */
export function renderNothingWaiting(): string {
  return 'Nothing is waiting on a human in the channels you are in.';
}

/**
 * The glyph the prompt and the parked status post lead with (§8.1), then what is being decided: the
 * action for an approval, and for a question the head of its words on one line as well.
 */
export function renderPendingDecisionSubject(decision: PendingDecision): string {
  if (decision.kind === 'approval') {
    return `${DECISION_GLYPHS.approval} \`${decision.actionName}\``;
  }
  const question = decision.question.replaceAll(/\s+/gu, ' ').trim();
  const head =
    question.length > QUESTION_HEAD_LIMIT_CHARS ? `${question.slice(0, QUESTION_HEAD_LIMIT_CHARS)}…` : question;
  return `${DECISION_GLYPHS.ask} \`${decision.actionName}\` "${head}"`;
}

/** §8.1 — a decision a turn is parked on where a turn or its work is shown: what, how long, since when, and where to answer it */
export function renderParkedOn({ decision, since }: ParkedDecision, now: Date): string {
  return `${renderPendingDecisionSubject(decision)} · for ${renderPendingAge(decision.requestedAt, now)}, since ${since} · ${renderPromptReference(decision)}`;
}

/**
 * Oldest first, capped: an unbounded pending set would otherwise produce a post too large to
 * deliver, exactly when the listing is most worth having.
 */
export function renderPendingDecisions(rows: readonly PendingDecisionListing[], now: Date): string {
  const shown = rows.slice(0, PENDING_LISTING_LIMIT);
  const remainder = rows.length - shown.length;
  return [
    `${renderPendingCounts(rows)} waiting on a human:`,
    ...shown.map((row) => {
      const where = row.channelName === undefined ? [] : [row.channelName];
      return `· @${row.agentUsername} · ${renderPendingDecisionSubject(row)} · ${renderPendingAge(row.requestedAt, now)} · ${[...where, renderPromptReference(row)].join(' · ')}`;
    }),
    ...(remainder > 0 ? [`…and ${remainder} more.`] : [])
  ].join('\n');
}
