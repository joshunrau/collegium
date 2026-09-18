import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getModelToken } from '@/prisma/prisma.utils.ts';

import { QueueService } from '../queue.service.ts';

type EntryRow = {
  agentUsername: string;
  channelId: string;
  earliestUnprocessedPostId: string;
  id: string;
  lastEnqueuedAt: Date;
};

describe('QueueService', () => {
  let queueService: QueueService;
  let rows: EntryRow[];
  let sequence: number;

  beforeEach(async () => {
    vi.useFakeTimers({ now: 0, toFake: ['Date'] });
    rows = [];
    sequence = 0;
    const matches = (row: EntryRow, where: any) => {
      return Object.entries(where).every(([field, value]) => {
        const actual = row[field as keyof EntryRow];
        return value instanceof Date
          ? actual instanceof Date && actual.getTime() === value.getTime()
          : actual === value;
      });
    };
    const findByKey = (where: any) => rows.find((row) => matches(row, where.agentUsername_channelId));
    const moduleRef = await Test.createTestingModule({
      providers: [
        QueueService,
        {
          provide: getModelToken('QueueEntry'),
          useValue: {
            delete: ({ where }: any) => {
              rows.splice(
                rows.findIndex((row) => row.id === where.id),
                1
              );
              return Promise.resolve();
            },
            deleteMany: ({ where }: any) => {
              const doomed = rows.filter((row) => matches(row, where));
              rows = rows.filter((row) => !doomed.includes(row));
              return Promise.resolve({ count: doomed.length });
            },
            findMany: () => Promise.resolve([...rows]),
            findUnique: ({ where }: any) => {
              const found = findByKey(where);
              return Promise.resolve(found ? { ...found } : null);
            },
            updateMany: ({ data, where }: any) => {
              const matching = rows.filter((row) => matches(row, where));
              for (const row of matching) {
                Object.assign(row, data);
              }
              return Promise.resolve({ count: matching.length });
            },
            upsert: ({ create, update, where }: any) => {
              const standing = findByKey(where);
              if (standing) {
                return Promise.resolve(Object.assign(standing, update));
              }
              const row = { id: `entry-${sequence++}`, ...create };
              rows.push(row);
              return Promise.resolve(row);
            }
          }
        }
      ]
    }).compile();
    queueService = moduleRef.get(QueueService);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should store one row per agent and channel, holding the earliest unprocessed post id', async () => {
    await queueService.enqueue('mira', 'channel-1', 'post-1');
    await queueService.enqueue('mira', 'channel-1', 'post-2');
    await queueService.enqueue('mira', 'channel-2', 'post-3');
    expect(rows).toHaveLength(2);
    expect((await queueService.peek('mira', 'channel-1'))?.earliestUnprocessedPostId).toBe('post-1');
  });

  it('should clear the flag on drain without storing post content', async () => {
    await queueService.enqueue('mira', 'channel-1', 'post-1');
    const drained = await queueService.drain('mira', 'channel-1');
    expect(drained?.earliestUnprocessedPostId).toBe('post-1');
    expect(rows).toHaveLength(0);
    expect(await queueService.drain('mira', 'channel-1')).toBeUndefined();
  });

  it('should throw the standing entry away on discard, leaving nothing for the next drain', async () => {
    await queueService.enqueue('mira', 'channel-1', 'post-1');
    expect((await queueService.discard('mira', 'channel-1'))?.earliestUnprocessedPostId).toBe('post-1');
    expect(rows).toHaveLength(0);
    expect(await queueService.drain('mira', 'channel-1')).toBeUndefined();
  });

  it("should leave another channel's entry standing when one is discarded", async () => {
    await queueService.enqueue('mira', 'channel-1', 'post-1');
    await queueService.enqueue('mira', 'channel-2', 'post-2');
    await queueService.discard('mira', 'channel-1');
    expect((await queueService.peek('mira', 'channel-2'))?.earliestUnprocessedPostId).toBe('post-2');
  });

  it('should stamp the entry on every enqueue while keeping the earliest pointer', async () => {
    await queueService.enqueue('mira', 'channel-1', 'post-1');
    vi.setSystemTime(5);
    await queueService.enqueue('mira', 'channel-1', 'post-2');
    expect(rows).toStrictEqual([
      expect.objectContaining({ earliestUnprocessedPostId: 'post-1', lastEnqueuedAt: new Date(5) })
    ]);
  });

  it('should consume the entry only while it stands as it was read (§5.2)', async () => {
    await queueService.enqueue('mira', 'channel-1', 'post-1');
    const read = (await queueService.peek('mira', 'channel-1'))!;
    vi.setSystemTime(5);
    await queueService.enqueue('mira', 'channel-1', 'post-2');
    expect(await queueService.consumeIfUnchanged(read)).toBe(false);
    expect(await queueService.consumeIfUnchanged((await queueService.peek('mira', 'channel-1'))!)).toBe(true);
    expect(rows).toHaveLength(0);
  });

  it('should list every standing entry for the sweep to walk', async () => {
    await queueService.enqueue('mira', 'channel-1', 'post-1');
    await queueService.enqueue('owen', 'channel-2', 'post-2');
    expect((await queueService.listAll()).map((entry) => entry.agentUsername)).toStrictEqual(['mira', 'owen']);
  });

  it('should move a standing pointer to the post the caller names, stamping the entry', async () => {
    await queueService.enqueue('mira', 'channel-1', 'post-9');
    vi.setSystemTime(5);
    await queueService.pointAt('mira', 'channel-1', 'post-1');
    expect(rows).toStrictEqual([
      expect.objectContaining({ earliestUnprocessedPostId: 'post-1', lastEnqueuedAt: new Date(5) })
    ]);
  });

  it('should hold pointers alone, rebuilding from a fresh enqueue after a drain', async () => {
    await queueService.enqueue('mira', 'channel-1', 'post-1');
    expect(Object.keys(rows[0]!).toSorted()).toStrictEqual([
      'agentUsername',
      'channelId',
      'earliestUnprocessedPostId',
      'id',
      'lastEnqueuedAt'
    ]);
    await queueService.drain('mira', 'channel-1');
    await queueService.enqueue('mira', 'channel-1', 'post-9');
    expect((await queueService.peek('mira', 'channel-1'))?.earliestUnprocessedPostId).toBe('post-9');
  });
});
