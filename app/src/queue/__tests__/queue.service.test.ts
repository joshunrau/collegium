import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { Prisma } from '@/prisma/generated/client.ts';
import { getModelToken } from '@/prisma/prisma.utils.ts';

import { QueueService } from '../queue.service.ts';

type EntryRow = { agentUsername: string; channelId: string; earliestUnprocessedPostId: string; id: string };

describe('QueueService', () => {
  let createFailure: Error | undefined;
  let queueService: QueueService;
  let rows: EntryRow[];
  let sequence: number;

  beforeEach(async () => {
    createFailure = undefined;
    rows = [];
    sequence = 0;
    const moduleRef = await Test.createTestingModule({
      providers: [
        QueueService,
        {
          provide: getModelToken('QueueEntry'),
          useValue: {
            create: ({ data }: any) => {
              if (createFailure) {
                throw createFailure;
              }
              if (rows.some((row) => row.agentUsername === data.agentUsername && row.channelId === data.channelId)) {
                throw new Prisma.PrismaClientKnownRequestError('unique', { clientVersion: '0', code: 'P2002' });
              }
              const row = { id: `entry-${sequence++}`, ...data };
              rows.push(row);
              return Promise.resolve(row);
            },
            delete: ({ where }: any) => {
              rows.splice(
                rows.findIndex((row) => row.id === where.id),
                1
              );
              return Promise.resolve();
            },
            findMany: () => Promise.resolve([...rows]),
            findUnique: ({ where }: any) =>
              Promise.resolve(
                rows.find(
                  (row) =>
                    row.agentUsername === where.agentUsername_channelId.agentUsername &&
                    row.channelId === where.agentUsername_channelId.channelId
                ) ?? null
              )
          }
        }
      ]
    }).compile();
    queueService = moduleRef.get(QueueService);
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

  it('should rethrow a store failure that is not a duplicate entry', async () => {
    createFailure = new Error('database is locked');
    await expect(queueService.enqueue('mira', 'channel-1', 'post-1')).rejects.toThrow('database is locked');
  });

  it('should list every standing entry for the sweep to walk', async () => {
    await queueService.enqueue('mira', 'channel-1', 'post-1');
    await queueService.enqueue('owen', 'channel-2', 'post-2');
    expect((await queueService.listAll()).map((entry) => entry.agentUsername)).toStrictEqual(['mira', 'owen']);
  });

  it('should hold pointers alone, rebuilding from a fresh enqueue after a drain', async () => {
    await queueService.enqueue('mira', 'channel-1', 'post-1');
    expect(Object.keys(rows[0]!).toSorted()).toStrictEqual([
      'agentUsername',
      'channelId',
      'earliestUnprocessedPostId',
      'id'
    ]);
    await queueService.drain('mira', 'channel-1');
    await queueService.enqueue('mira', 'channel-1', 'post-9');
    expect((await queueService.peek('mira', 'channel-1'))?.earliestUnprocessedPostId).toBe('post-9');
  });
});
