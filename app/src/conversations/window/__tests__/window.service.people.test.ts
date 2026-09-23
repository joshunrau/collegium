import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AuthorKind } from '@/prisma/prisma.types.ts';
import { getModelToken } from '@/prisma/prisma.utils.ts';
import { createMigratedDatabase } from '@/testing/factories/migrated-database.factory.ts';
import type { MigratedDatabase } from '@/testing/factories/migrated-database.factory.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';

import { EpisodesService } from '../../episodes/episodes.service.ts';
import { WindowService } from '../window.service.ts';

describe('WindowService.listRecentPeople against the store (§3.11)', () => {
  let database: MigratedDatabase;
  let episodesService: MockedInstance<EpisodesService>;
  let windowService: WindowService;

  beforeEach(async () => {
    database = createMigratedDatabase();
    episodesService = MockFactory.createMock(EpisodesService);
    episodesService.latestBoundary.mockResolvedValue(undefined);
    const moduleRef = await Test.createTestingModule({
      providers: [
        WindowService,
        { provide: EpisodesService, useValue: episodesService },
        { provide: getModelToken('Post'), useValue: database.client.post },
        { provide: getModelToken('TurnEvent'), useValue: database.client.turnEvent }
      ]
    }).compile();
    windowService = moduleRef.get(WindowService);
  });

  afterEach(() => database.dispose());

  const post = (id: string, at: number, authorUsername: string, authorKind: AuthorKind = 'human') => {
    return database.client.post.create({
      data: { authorKind, authorUsername, channelId: 'channel-1', createdAt: new Date(at), id, message: id }
    });
  };

  const listRecentPeople = (take = 5) => {
    return windowService.listRecentPeople({ agentUsername: 'mira', channelId: 'channel-1', take });
  };

  it('should list each person once, the latest poster first, and no agent or system bot', async () => {
    await post('post-1', 1000, 'casey');
    await post('post-2', 2000, 'joshua');
    await post('post-3', 3000, 'casey');
    await post('post-4', 4000, 'tess', 'agent');
    await post('post-5', 5000, 'collegium', 'system');
    expect(await listRecentPeople()).toStrictEqual(['casey', 'joshua']);
  });

  it('should list at most the requested number of people', async () => {
    await post('post-1', 1000, 'casey');
    await post('post-2', 2000, 'joshua');
    await post('post-3', 3000, 'robin');
    expect(await listRecentPeople(2)).toStrictEqual(['robin', 'joshua']);
  });

  it('should reach no further back than the window, past neither the episode boundary nor a forgotten post (§3.8)', async () => {
    episodesService.latestBoundary.mockResolvedValue({ eventsAfter: new Date(1500), postsAfter: new Date(1500) });
    await post('post-1', 1000, 'casey');
    await post('post-2', 2000, 'joshua');
    await post('post-3', 3000, 'robin');
    await database.client.post.update({ data: { isForgotten: true }, where: { id: 'post-3' } });
    expect(await listRecentPeople()).toStrictEqual(['joshua']);
  });
});
