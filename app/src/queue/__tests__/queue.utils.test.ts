import { describe, expect, it } from 'vitest';

import { chooseDrainTrigger, findEarliestQueued, selectTakable } from '../queue.utils.ts';

import type { QueuedPost, QueueEntry } from '../queue.utils.ts';

const entry = (postId: string, enqueuedMs: number, takenByTurnId: null | string = null): QueueEntry => ({
  agentUsername: 'mira',
  channelId: 'channel-1',
  enqueuedAt: new Date(enqueuedMs),
  id: `entry-${postId}`,
  postId,
  returnedOnce: false,
  takenByTurnId
});

const queued = (id: string, createdMs: number, authorKind: QueuedPost['authorKind']): QueuedPost => ({
  authorKind,
  createdAt: new Date(createdMs),
  id
});

describe('selectTakable', () => {
  it('should select the untaken rows queued at or before the bound, oldest first (§5.2)', () => {
    const rows = [entry('post-3', 3_000), entry('post-1', 1_000), entry('post-2', 2_000, 'turn-0')];
    expect(selectTakable(rows, new Date(3_000)).map((row) => row.postId)).toStrictEqual(['post-1', 'post-3']);
    expect(selectTakable(rows, new Date(2_999)).map((row) => row.postId)).toStrictEqual(['post-1']);
  });
});

describe('chooseDrainTrigger', () => {
  it("should answer the newest person's post, even ahead of a later colleague's (§5.2)", () => {
    const posts = [queued('report', 1_000, 'agent'), queued('ask-1', 2_000, 'human'), queued('ask-2', 3_000, 'human')];
    expect(chooseDrainTrigger([...posts, queued('later', 4_000, 'agent')])?.id).toBe('ask-2');
  });

  it("should answer the earliest post of a drain of colleagues' posts only", () => {
    const posts = [queued('second', 2_000, 'agent'), queued('first', 1_000, 'agent')];
    expect(chooseDrainTrigger(posts)?.id).toBe('first');
    expect(findEarliestQueued(posts)?.id).toBe('first');
  });
});
