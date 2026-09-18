import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { getModelToken } from '@/prisma/prisma.utils.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';
import { createModelTable } from '@/testing/factories/model-table.factory.ts';

import { EpisodesService } from '../../episodes/episodes.service.ts';
import { WindowService } from '../window.service.ts';

type PostRow = {
  authoringTurnId: null | string;
  authorUsername: string;
  channelId: string;
  createdAt: Date;
  id: string;
  isForgotten: boolean;
  kind: 'message' | 'notice' | 'reply' | 'status';
  message: string;
  observedAt: Date;
};
type TurnRef = { agentUsername: string; channelId: string };
type EventRow = {
  createdAt: Date;
  id: string;
  kind: string;
  payload: unknown;
  sequence: number;
  turn: TurnRef;
};

const post = (id: string, at: number, overrides: Partial<PostRow> = {}): PostRow => ({
  authoringTurnId: null,
  authorUsername: 'casey',
  channelId: 'channel-1',
  createdAt: new Date(at),
  id,
  isForgotten: false,
  kind: 'message',
  message: `message ${id}`,
  observedAt: new Date(at),
  ...overrides
});

const event = (id: string, at: number, turn: TurnRef, sequence = 0): EventRow => ({
  createdAt: new Date(at),
  id,
  kind: 'tool_result',
  payload: {
    callId: id,
    kind: 'tool_result',
    output: 'output',
    replay: `[did ${id}]`,
    toolName: ['workspace', 'write']
  },
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

  const createService = async (posts: PostRow[], events: EventRow[]) => {
    const tables = createTables(posts, events);
    const moduleRef = await Test.createTestingModule({
      providers: [
        WindowService,
        { provide: EpisodesService, useValue: episodesService },
        { provide: getModelToken('Post'), useValue: tables.posts },
        { provide: getModelToken('TurnEvent'), useValue: tables.events }
      ]
    }).compile();
    const service = moduleRef.get(WindowService);
    return {
      build: (budgetTokens = 1000) => service.build({ agentUsername: 'mira', budgetTokens, channelId: 'channel-1' }),
      readRecentActions: (before: number, take = 20) => {
        return service.readRecentActions({
          agentUsername: 'mira',
          before: new Date(before),
          channelId: 'channel-1',
          take
        });
      },
      tables
    };
  };

  const build = async (posts: PostRow[], events: EventRow[], budgetTokens = 1000) => {
    return (await createService(posts, events)).build(budgetTokens);
  };

  const identify = (result: Awaited<ReturnType<typeof build>>) => {
    return result.entries.map((entry) => (entry.kind === 'post' ? entry.post.id : entry.event.id));
  };

  beforeEach(() => {
    episodesService = MockFactory.createMock(EpisodesService);
    episodesService.latestBoundary.mockResolvedValue(undefined);
  });

  it('should walk the channel backwards until the token budget is exhausted, returning oldest first', async () => {
    const posts = [post('post-1', 1000), post('post-2', 2000), post('post-3', 3000)];
    const entries = await build(posts, [], 8);
    expect(identify(entries)).toStrictEqual(['post-2', 'post-3']);
  });

  it('should stop at the most recent episode boundary however much budget remains', async () => {
    episodesService.latestBoundary.mockResolvedValue({ eventsAfter: new Date(2000), postsAfter: new Date(2000) });
    const posts = [post('post-1', 1000), post('post-2', 2000), post('post-3', 3000)];
    const entries = await build(posts, []);
    expect(identify(entries)).toStrictEqual(['post-3']);
  });

  it('should skip forgotten posts', async () => {
    const posts = [post('post-1', 1000), post('post-2', 2000, { isForgotten: true }), post('post-3', 3000)];
    const entries = await build(posts, []);
    expect(identify(entries)).toStrictEqual(['post-1', 'post-3']);
  });

  it("should leave out the posts the reading agent's own turns authored, keeping ones it merely observed", async () => {
    const posts = [
      post('post-1', 1000, { authoringTurnId: 'turn-1', authorUsername: 'mira' }),
      post('post-2', 2000, { authorUsername: 'mira' }),
      post('post-3', 3000, { authoringTurnId: 'turn-2', authorUsername: 'tess' })
    ];
    const entries = await build(posts, []);
    expect(identify(entries)).toStrictEqual(['post-2', 'post-3']);
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

  it("should leave out a peer's status post, keeping its notice and its reply (§3.8)", async () => {
    const posts = [
      post('post-1', 1000, { authoringTurnId: 'turn-9', authorUsername: 'tess', kind: 'status' }),
      post('post-2', 2000, { authoringTurnId: 'turn-9', authorUsername: 'tess', kind: 'notice' }),
      post('post-3', 3000, { authoringTurnId: 'turn-9', authorUsername: 'tess', kind: 'reply' })
    ];
    const entries = await build(posts, []);
    expect(identify(entries)).toStrictEqual(['post-2', 'post-3']);
  });

  it('should charge a replayed tool result at its replay line, not its output', async () => {
    const mira = { agentUsername: 'mira', channelId: 'channel-1' };
    const replayed = event('event-1', 2000, mira);
    replayed.payload = {
      callId: 'c',
      kind: 'tool_result',
      output: 'x'.repeat(4000),
      replay: '[loaded]',
      toolName: 't'
    };
    const entries = await build([post('post-1', 1000)], [replayed], 20);
    expect(identify(entries)).toStrictEqual(['post-1', 'event-1']);
  });

  // each fixture post costs four tokens
  it('should hold the oldest entry fixed while everything since it still fits the budget', async () => {
    const { build: rebuild, tables } = await createService([post('post-1', 1000), post('post-2', 2000)], []);
    expect(identify(await rebuild(12))).toStrictEqual(['post-1', 'post-2']);
    tables.posts.rows.push(post('post-3', 3000));
    expect(identify(await rebuild(12))).toStrictEqual(['post-1', 'post-2', 'post-3']);
  });

  it('should trim to the low-water mark once the anchored window overflows, then hold there', async () => {
    const { build: rebuild, tables } = await createService([post('post-1', 1000), post('post-2', 2000)], []);
    await rebuild(16);
    tables.posts.rows.push(post('post-3', 3000), post('post-4', 4000), post('post-5', 5000));
    expect(identify(await rebuild(16))).toStrictEqual(['post-3', 'post-4', 'post-5']);
    tables.posts.rows.push(post('post-6', 6000));
    expect(identify(await rebuild(16))).toStrictEqual(['post-3', 'post-4', 'post-5', 'post-6']);
  });

  it('should read the channel a page at a time and still walk past the first page', async () => {
    const posts = Array.from({ length: 450 }, (_, index) => post(`post-${index + 1}`, 1000 * (index + 1)));
    const result = await build(posts, [], 100_000);
    expect(result.entries).toHaveLength(450);
    expect(identify(result).at(0)).toBe('post-1');
  });

  it('should report the instant its oldest entry was created', async () => {
    const result = await build([post('post-1', 1000), post('post-2', 2000)], [], 4);
    expect(result.oldestAt).toStrictEqual(new Date(2000));
  });

  it('should report the anchor as the oldest instant while the anchored read still fits', async () => {
    const { build: rebuild, tables } = await createService([post('post-1', 1000)], []);
    await rebuild(12);
    tables.posts.rows.push(post('post-2', 2000));
    expect((await rebuild(12)).oldestAt).toStrictEqual(new Date(1000));
  });

  it('should report no oldest instant for an empty window', async () => {
    expect((await build([], [])).oldestAt).toBeUndefined();
  });

  it('should read only its own actions from before the window, newest first', async () => {
    const mira = { agentUsername: 'mira', channelId: 'channel-1' };
    const events = [
      event('event-1', 1000, mira),
      event('event-2', 2000, mira),
      event('elsewhere', 1500, { agentUsername: 'mira', channelId: 'channel-2' }),
      event('peer', 1500, { agentUsername: 'tess', channelId: 'channel-1' }),
      event('event-3', 3000, mira)
    ];
    const { readRecentActions } = await createService([], events);
    expect(await readRecentActions(3000)).toStrictEqual(['[did event-2]', '[did event-1]']);
  });

  it("should read no action older than the channel's episode boundary", async () => {
    episodesService.latestBoundary.mockResolvedValue({ eventsAfter: new Date(1500), postsAfter: new Date(1500) });
    const mira = { agentUsername: 'mira', channelId: 'channel-1' };
    const { readRecentActions } = await createService([], [event('event-1', 1000, mira), event('event-2', 2000, mira)]);
    expect(await readRecentActions(3000)).toStrictEqual(['[did event-2]']);
  });

  it('should read at most the requested number of actions', async () => {
    const mira = { agentUsername: 'mira', channelId: 'channel-1' };
    const events = Array.from({ length: 5 }, (_, index) => event(`event-${index}`, 1000 * (index + 1), mira));
    const { readRecentActions } = await createService([], events);
    expect(await readRecentActions(9000, 2)).toStrictEqual(['[did event-4]', '[did event-3]']);
  });
});
