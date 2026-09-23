import { renderElapsed } from '@/formatting/durations/duration.utils.ts';
import type { Turn } from '@/turns/turns.types.ts';

const SNIPPET_LIMIT_CHARS = 80;

function renderBacklog(backlog: QueueBacklog | undefined): string {
  if (backlog === undefined) {
    return 'Queue: empty.';
  }
  const { earliestUnprocessedPostId, summary } = backlog;
  const depth = summary === undefined ? 'an unknown number of' : summary.pendingCount;
  const snippet = summary === undefined ? '' : ` — "${summary.message.slice(0, SNIPPET_LIMIT_CHARS)}"`;
  return `Queue: ${depth} post(s) pending; oldest unprocessed is \`${earliestUnprocessedPostId}\`${snippet}`;
}

function renderLane(agentUsername: string, hold: LaneHold | undefined): string {
  if (hold === undefined) {
    return `${agentUsername} in this channel: no turn running.`;
  }
  const held = `for ${renderElapsed(hold.heldForMs)}, since ${hold.heldSince}`;
  const queuesBehind = `A post addressing ${agentUsername} now queues behind it.`;
  if (hold.turn === undefined) {
    return `${agentUsername} in this channel: lane held ${held}, with no turn open — one is opening or has just closed. ${queuesBehind}`;
  }
  const { statusPostId, triggeringPostId } = hold.turn;
  const startedBy = triggeringPostId === null ? '' : `, started by post \`${triggeringPostId}\``;
  const statusPost = statusPostId === null ? 'no status post yet' : `status post \`${statusPostId}\``;
  return `${agentUsername} in this channel: turn running ${held}${startedBy}; ${statusPost}. ${queuesBehind}`;
}

/** an agent's lock in a channel (§5.1), and the turn holding it where one is open */
export type LaneHold = {
  readonly heldForMs: number;
  /** in the operator timezone */
  readonly heldSince: string;
  /** undefined while the lock is held between turns: one is opening, or has just closed */
  readonly turn: Pick<Turn, 'statusPostId' | 'triggeringPostId'> | undefined;
};

/** the standing queue entry, and the backlog behind its pointer where the store still holds that post */
export type QueueBacklog = {
  readonly earliestUnprocessedPostId: string;
  readonly summary: undefined | { message: string; pendingCount: number };
};

/** §8.4 — the lane first: a turn with no call yet has no status post (§8.1), and a post addressing it would queue (§5.2) */
export function renderLaneReport(
  agentUsername: string,
  hold: LaneHold | undefined,
  backlog: QueueBacklog | undefined
): string {
  return [renderLane(agentUsername, hold), renderBacklog(backlog)].join('\n');
}
