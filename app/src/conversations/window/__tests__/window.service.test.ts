import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { getModelToken } from '@/prisma/prisma.utils.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';
import { createModelTable } from '@/testing/factories/model-table.factory.ts';

import { EpisodesService } from '../../episodes/episodes.service.ts';
import { WindowService } from '../window.service.ts';

type PostRow = {
  channelId: string;
  createdAt: Date;
  id: string;
  isForgotten: boolean;
  message: string;
  observedAt: Date;
};
type TurnRef = { agentUsername: string; channelId: string };
type EventRow = { createdAt: Date; id: string; payload: unknown; sequence: number; turn: TurnRef };

const post = (id: string, at: number, overrides: Partial<PostRow> = {}): PostRow => ({
  channelId: 'channel-1',
  createdAt: new Date(at),
  id,
  isForgotten: false,
  message: `message ${id}`,
  observedAt: new Date(at),
  ...overrides
});

const event = (id: string, at: number, turn: TurnRef, sequence = 0): EventRow => ({
  createdAt: new Date(at),
  id,
  payload: { kind: 'tool_result' },
  sequence,
  turn
});

const createTables = (posts: PostRow[], events: EventRow[]) => {
  const postTable = createModelTable<PostRow>();
  postTable.rows.push(...posts);
  const eventTable = createModelTable<EventRow>();
  eventTable.rows.push(...events);
  return { events: eventTable, posts: postTable };
};

describe('WindowService', () => {
  let episodesService: MockedInstance<EpisodesService>;

  const build = async (posts: PostRow[], events: EventRow[], budgetTokens = 1000) => {
    const tables = createTables(posts, events);
    const moduleRef = await Test.createTestingModule({
      providers: [
        WindowService,
        { provide: EpisodesService, useValue: episodesService },
        { provide: getModelToken('Post'), useValue: tables.posts },
        { provide: getModelToken('TurnEvent'), useValue: tables.events }
      ]
    }).compile();
    return moduleRef.get(WindowService).build({ agentUsername: 'mira', budgetTokens, channelId: 'channel-1' });
  };

  const identify = (entries: Awaited<ReturnType<typeof build>>) => {
    return entries.map((entry) => (entry.kind === 'post' ? entry.post.id : entry.event.id));
  };

  beforeEach(() => {
    episodesService = MockFactory.createMock(EpisodesService);
    episodesService.latestBoundaryPostId.mockResolvedValue(undefined);
  });

  it('should walk the channel backwards until the token budget is exhausted, returning oldest first', async () => {
    const posts = [post('post-1', 1000), post('post-2', 2000), post('post-3', 3000)];
    const entries = await build(posts, [], 8);
    expect(identify(entries)).toStrictEqual(['post-2', 'post-3']);
  });

  it('should stop at the most recent episode boundary however much budget remains', async () => {
    episodesService.latestBoundaryPostId.mockResolvedValue('post-2');
    const posts = [post('post-1', 1000), post('post-2', 2000), post('post-3', 3000)];
    const entries = await build(posts, []);
    expect(identify(entries)).toStrictEqual(['post-3']);
  });

  it('should ignore an episode boundary whose post is no longer stored', async () => {
    episodesService.latestBoundaryPostId.mockResolvedValue('post-forgotten');
    const entries = await build([post('post-1', 1000)], []);
    expect(identify(entries)).toStrictEqual(['post-1']);
  });

  it('should skip forgotten posts', async () => {
    const posts = [post('post-1', 1000), post('post-2', 2000, { isForgotten: true }), post('post-3', 3000)];
    const entries = await build(posts, []);
    expect(identify(entries)).toStrictEqual(['post-1', 'post-3']);
  });

  it("should interleave the reading agent's own turn trace in time order, never a peer's", async () => {
    const mira = { agentUsername: 'mira', channelId: 'channel-1' };
    const tess = { agentUsername: 'tess', channelId: 'channel-1' };
    const posts = [post('post-1', 1000), post('post-2', 4000)];
    const events = [event('event-1', 2000, mira, 0), event('event-2', 3000, mira, 1), event('peer-1', 2500, tess)];
    const entries = await build(posts, events);
    expect(identify(entries)).toStrictEqual(['post-1', 'event-1', 'event-2', 'post-2']);
  });

  it("should not read another channel's trace for the same agent", async () => {
    const elsewhere = { agentUsername: 'mira', channelId: 'channel-2' };
    const entries = await build([post('post-1', 1000)], [event('event-1', 2000, elsewhere)]);
    expect(identify(entries)).toStrictEqual(['post-1']);
  });
});
