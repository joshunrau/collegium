import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { getModelToken } from '@/prisma/prisma.utils.ts';

import { EpisodesService } from '../episodes.service.ts';

type EpisodeRow = { agentUsername: string; channelId: string; createdAt: Date; postId: string };

describe('EpisodesService', () => {
  let episodesService: EpisodesService;
  let episodes: EpisodeRow[];
  let posts: { id: string; isForgotten: boolean }[];
  let sequence: number;

  beforeEach(async () => {
    episodes = [];
    posts = [{ id: 'post-1', isForgotten: false }];
    sequence = 0;
    const moduleRef = await Test.createTestingModule({
      providers: [
        EpisodesService,
        {
          provide: getModelToken('Episode'),
          useValue: {
            create: ({ data }: any) => {
              const row = { ...data, createdAt: new Date(sequence++) };
              episodes.push(row);
              return Promise.resolve(row);
            },
            findFirst: ({ where }: any) =>
              Promise.resolve(
                episodes
                  .filter((row) => row.agentUsername === where.agentUsername && row.channelId === where.channelId)
                  .toSorted((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0] ?? null
              )
          }
        },
        {
          provide: getModelToken('Post'),
          useValue: {
            updateMany: ({ data, where }: any) => {
              const matching = posts.filter((row) => row.id === where.id);
              matching.forEach((row) => Object.assign(row, data));
              return Promise.resolve({ count: matching.length });
            }
          }
        }
      ]
    }).compile();
    episodesService = moduleRef.get(EpisodesService);
  });

  it('should return the most recently marked boundary for the agent and channel', async () => {
    await episodesService.mark('mira', 'channel-1', 'post-1');
    await episodesService.mark('mira', 'channel-1', 'post-2');
    await episodesService.mark('tess', 'channel-1', 'post-3');
    expect(await episodesService.latestBoundaryPostId('mira', 'channel-1')).toBe('post-2');
    expect(await episodesService.latestBoundaryPostId('mira', 'channel-2')).toBeUndefined();
  });

  it('should mark a recorded post forgotten and refuse an unrecorded one', async () => {
    expect((await episodesService.forget('post-1')).success).toBe(true);
    expect(posts[0]?.isForgotten).toBe(true);
    expect((await episodesService.forget('post-9')).error).toStrictEqual({ kind: 'post-not-found', postId: 'post-9' });
  });
});
