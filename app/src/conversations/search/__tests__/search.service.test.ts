import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { getModelToken } from '@/prisma/prisma.utils.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';
import { createModelTable } from '@/testing/factories/model-table.factory.ts';

import { EpisodesService } from '../../episodes/episodes.service.ts';
import { SearchService } from '../search.service.ts';

import type { SearchInput } from '../../conversations.types.ts';

type PostRow = {
  authorUsername: string;
  channelId: string;
  createdAt: Date;
  id: string;
  isForgotten: boolean;
  message: string;
};

const post = (id: string, at: number, overrides: Partial<PostRow> = {}): PostRow => ({
  authorUsername: 'casey',
  channelId: 'channel-1',
  createdAt: new Date(at),
  id,
  isForgotten: false,
  message: `the Budget for ${id}`,
  ...overrides
});

const CHANNELS = [
  { channelId: 'channel-1', name: 'Main' },
  { channelId: 'channel-2', name: 'Ops' }
];

describe('SearchService', () => {
  let episodesService: MockedInstance<EpisodesService>;

  const find = async (rows: PostRow[], overrides: Partial<SearchInput> = {}) => {
    const posts = createModelTable<PostRow>();
    posts.rows.push(...rows);
    const moduleRef = await Test.createTestingModule({
      providers: [
        SearchService,
        { provide: EpisodesService, useValue: episodesService },
        { provide: getModelToken('Post'), useValue: posts }
      ]
    }).compile();
    return moduleRef
      .get(SearchService)
      .find({ agentUsername: 'mira', channels: CHANNELS, limit: 10, query: 'budget', ...overrides });
  };

  beforeEach(() => {
    episodesService = MockFactory.createMock(EpisodesService);
    episodesService.latestBoundary.mockResolvedValue(undefined);
  });

  it('should match a substring without regard to case, newest first, naming each source channel', async () => {
    const hits = await find([post('post-1', 1000), post('post-2', 2000, { channelId: 'channel-2' })]);
    expect(hits.map((hit) => [hit.id, hit.channelName])).toStrictEqual([
      ['post-2', 'Ops'],
      ['post-1', 'Main']
    ]);
  });

  it('should read only the channels it was given', async () => {
    const hits = await find([post('post-1', 1000, { channelId: 'channel-9' })]);
    expect(hits).toStrictEqual([]);
  });

  it('should read nothing when given no channels', async () => {
    expect(await find([post('post-1', 1000)], { channels: [] })).toStrictEqual([]);
  });

  it('should reach back no further than each channel’s own episode boundary', async () => {
    episodesService.latestBoundary.mockImplementation((_, channelId) => {
      return Promise.resolve(
        channelId === 'channel-1' ? { eventsAfter: new Date(1500), postsAfter: new Date(1500) } : undefined
      );
    });
    const hits = await find([
      post('post-1', 1000),
      post('post-2', 2000),
      post('post-3', 1000, { channelId: 'channel-2' })
    ]);
    expect(hits.map((hit) => hit.id)).toStrictEqual(['post-2', 'post-3']);
  });

  it('should skip forgotten posts', async () => {
    const hits = await find([post('post-1', 1000, { isForgotten: true }), post('post-2', 2000)]);
    expect(hits.map((hit) => hit.id)).toStrictEqual(['post-2']);
  });

  it('should bound by author and by day', async () => {
    const rows = [
      post('post-1', 1000),
      post('post-2', 2000, { authorUsername: 'jo' }),
      post('post-3', 3000, { authorUsername: 'jo' })
    ];
    expect((await find(rows, { authorUsername: 'jo' })).map((hit) => hit.id)).toStrictEqual(['post-3', 'post-2']);
    expect((await find(rows, { from: new Date(1500), until: new Date(2500) })).map((hit) => hit.id)).toStrictEqual([
      'post-2'
    ]);
  });

  it('should return at most the limit', async () => {
    const hits = await find([post('post-1', 1000), post('post-2', 2000), post('post-3', 3000)], { limit: 2 });
    expect(hits.map((hit) => hit.id)).toStrictEqual(['post-3', 'post-2']);
  });
});
