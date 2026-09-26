import type { AuthorKind, ModelRow } from '@/prisma/prisma.types.ts';

const byEnqueued = (left: QueueEntry, right: QueueEntry): number => {
  return left.enqueuedAt.getTime() - right.enqueuedAt.getTime() || left.id.localeCompare(right.id);
};

const byCreated = (left: QueuedPost, right: QueuedPost): number => {
  return left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id);
};

export type QueueEntry = ModelRow<'QueueEntry'>;

/** one agent's queue in one channel, which is what its lane there holds (§5.1) */
export type QueueLane = {
  readonly agentUsername: string;
  readonly channelId: string;
};

/** what the store says of a queued post, as a drain chooses among them (§5.2) */
export type QueuedPost = {
  readonly authorKind: AuthorKind;
  readonly createdAt: Date;
  readonly id: string;
};

/**
 * §5.2 — what a take stamps: the untaken rows queued at or before its bound, oldest first. The bound
 * is the assembly's start, so every post taken was in the store the window was read from; a row
 * queued in the same millisecond is taken too, since the turn that folds a post reassembles at once.
 */
export function selectTakable(entries: readonly QueueEntry[], enqueuedBefore: Date): QueueEntry[] {
  return entries
    .filter((entry) => entry.takenByTurnId === null && entry.enqueuedAt.getTime() <= enqueuedBefore.getTime())
    .toSorted(byEnqueued);
}

/** §5.2 — the post a drain answers: the newest a person queued, else the earliest queued */
export function chooseDrainTrigger(posts: readonly QueuedPost[]): QueuedPost | undefined {
  const oldestFirst = posts.toSorted(byCreated);
  return oldestFirst.findLast((post) => post.authorKind === 'human') ?? oldestFirst[0];
}

/** §5.2 — the earliest queued post, which a drain records it began from */
export function findEarliestQueued(posts: readonly QueuedPost[]): QueuedPost | undefined {
  return posts.toSorted(byCreated)[0];
}
