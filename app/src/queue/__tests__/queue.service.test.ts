import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getModelToken } from '@/prisma/prisma.utils.ts';
import { createModelTable } from '@/testing/factories/model-table.factory.ts';
import type { ModelTable } from '@/testing/factories/model-table.factory.ts';

import { QueueService } from '../queue.service.ts';

import type { QueueEntry } from '../queue.utils.ts';

const LANE = { agentUsername: 'mira', channelId: 'channel-1' };

describe('QueueService', () => {
  let entries: ModelTable<QueueEntry>;
  let queueService: QueueService;

  beforeEach(async () => {
    vi.useFakeTimers({ now: 1_000, toFake: ['Date'] });
    entries = createModelTable<QueueEntry>({
      defaults: (sequence) => ({ id: `entry-${sequence}`, returnedOnce: false, takenByTurnId: null }),
      uniqueFields: [['agentUsername', 'channelId', 'postId']]
    });
    const moduleRef = await Test.createTestingModule({
      providers: [QueueService, { provide: getModelToken('QueueEntry'), useValue: entries }]
    }).compile();
    queueService = moduleRef.get(QueueService);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const queueAt = async (ms: number, postId: string, lane = LANE) => {
    vi.setSystemTime(ms);
    await queueService.insert(lane, postId);
  };

  it('should hold one row per queued post and ignore a repeat insert (§5.2)', async () => {
    await queueAt(1_000, 'post-1');
    await queueAt(2_000, 'post-1');
    await queueAt(2_000, 'post-1', { ...LANE, channelId: 'channel-2' });
    expect(entries.rows.map((entry) => [entry.channelId, entry.postId, entry.enqueuedAt.getTime()])).toStrictEqual([
      ['channel-1', 'post-1', 1_000],
      ['channel-2', 'post-1', 2_000]
    ]);
  });

  it('should take only the untaken rows of the lane queued at or before the bound (§5.2)', async () => {
    await queueAt(1_000, 'post-1');
    await queueAt(2_000, 'post-2');
    await queueAt(3_000, 'post-3');
    await queueAt(1_000, 'post-9', { ...LANE, agentUsername: 'owen' });
    expect(await queueService.take('turn-1', LANE, new Date(2_000))).toStrictEqual(['post-1', 'post-2']);
    expect(await queueService.take('turn-2', LANE, new Date(3_000))).toStrictEqual(['post-3']);
    expect((await queueService.listUntaken(LANE)).map((entry) => entry.postId)).toStrictEqual([]);
  });

  it('should return what a turn took to the queue, and consume what another took (§7.1)', async () => {
    await queueAt(1_000, 'post-1');
    await queueService.take('turn-1', LANE, new Date(1_000));
    await queueAt(2_000, 'post-2');
    await queueService.take('turn-2', LANE, new Date(2_000));
    expect(await queueService.returnTaken('turn-1')).toStrictEqual(['post-1']);
    await queueService.consume('turn-2');
    expect(entries.rows.map((entry) => [entry.postId, entry.takenByTurnId])).toStrictEqual([['post-1', null]]);
  });

  it('should return a crashed turn’s rows once, marked, and delete a row it had returned already (§7.3)', async () => {
    await queueAt(1_000, 'post-1');
    await queueService.insert(LANE, 'post-2', { returnedOnce: true });
    await queueService.take('turn-1', LANE, new Date(2_000));
    expect(await queueService.returnTakenOnce('turn-1')).toStrictEqual({ dropped: ['post-2'], returned: ['post-1'] });
    expect(entries.rows.map((entry) => [entry.postId, entry.returnedOnce, entry.takenByTurnId])).toStrictEqual([
      ['post-1', true, null]
    ]);
  });

  it('should discard what waits in the lane and leave what a running turn took (§8.4)', async () => {
    await queueAt(1_000, 'post-1');
    await queueService.take('turn-1', LANE, new Date(1_000));
    await queueAt(2_000, 'post-2');
    await queueAt(3_000, 'post-3');
    expect(await queueService.discard(LANE)).toBe(2);
    expect(entries.rows.map((entry) => entry.postId)).toStrictEqual(['post-1']);
  });

  it("should delete a forgotten post's rows in every lane, taken or not (§8.4)", async () => {
    await queueAt(1_000, 'post-1');
    await queueAt(1_000, 'post-1', { ...LANE, agentUsername: 'owen' });
    await queueService.take('turn-1', LANE, new Date(1_000));
    await queueAt(2_000, 'post-2');
    await queueService.deletePosts(['post-1']);
    expect(entries.rows.map((entry) => entry.postId)).toStrictEqual(['post-2']);
  });

  it('should list the standing rows oldest first, leaving out what a turn took', async () => {
    await queueAt(3_000, 'post-3');
    await queueAt(1_000, 'post-1', { ...LANE, agentUsername: 'owen' });
    await queueAt(2_000, 'post-2');
    await queueService.take('turn-1', LANE, new Date(2_000));
    expect((await queueService.listStanding()).map((entry) => entry.postId)).toStrictEqual(['post-1', 'post-3']);
  });
});
