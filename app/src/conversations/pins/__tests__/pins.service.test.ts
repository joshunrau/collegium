import { Result } from '@collegium/core/utils';
import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ChatTransport } from '@/chat/chat.transport.ts';
import type { ChatFailure } from '@/chat/chat.types.ts';
import { getModelToken } from '@/prisma/prisma.utils.ts';
import { createMigratedDatabase } from '@/testing/factories/migrated-database.factory.ts';
import type { MigratedDatabase } from '@/testing/factories/migrated-database.factory.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import { createObservedPost } from '@/testing/factories/observed-post.factory.ts';

import { ConversationsService } from '../../conversations.service.ts';
import { PinsService } from '../pins.service.ts';

import type { RecordablePost } from '../../conversations.types.ts';

const post = (id: string, at: number, message = id): RecordablePost => {
  return createObservedPost({ createdAt: new Date(at), id, message });
};

describe('PinsService', () => {
  let database: MigratedDatabase;
  let pinsService: PinsService;

  beforeEach(async () => {
    database = createMigratedDatabase();
    const moduleRef = await Test.createTestingModule({
      providers: [ConversationsService, PinsService, { provide: getModelToken('Post'), useValue: database.client.post }]
    }).compile();
    pinsService = moduleRef.get(PinsService);
  });

  afterEach(() => database.dispose());

  const listPinnedIds = async () => (await pinsService.listPinned('channel-1')).map(({ id }) => id);

  const transportPinning = (pinned: Result<RecordablePost[], ChatFailure>) => {
    const transport = MockFactory.createMock(ChatTransport);
    transport.pinnedPosts.mockResolvedValue(pinned);
    return transport;
  };

  it('should list the channel’s pinned posts oldest first, leaving out a forgotten one (§3.8)', async () => {
    await pinsService.pin(post('post-2', 2000));
    await pinsService.pin(post('post-1', 1000));
    await pinsService.pin(post('post-3', 3000));
    await pinsService.pin({ ...post('elsewhere', 1500), channelId: 'channel-2' });
    await database.client.post.update({ data: { isForgotten: true }, where: { id: 'post-3' } });
    expect(await listPinnedIds()).toStrictEqual(['post-1', 'post-2']);
  });

  it('should record a pinned post the store never saw, and follow the text of one it holds (§8.2)', async () => {
    await pinsService.pin(post('post-1', 1000, 'use the registry'));
    await pinsService.pin(post('post-1', 1000, 'use the registry, then the directory'));
    const [pinned] = await pinsService.listPinned('channel-1');
    expect(pinned?.message).toBe('use the registry, then the directory');
  });

  it('should unpin a post and keep its row as history', async () => {
    await pinsService.pin(post('post-1', 1000));
    await pinsService.unpin('post-1');
    expect(await listPinnedIds()).toStrictEqual([]);
    expect(await database.client.post.count({ where: { id: 'post-1' } })).toBe(1);
  });

  it('should reconcile the channel to the pins Mattermost holds now, whatever was missed (§8.2)', async () => {
    await pinsService.pin(post('post-1', 1000));
    await pinsService.pin(post('post-2', 2000));
    const reconciled = await pinsService.reconcile(
      transportPinning(Result.ok([post('post-2', 2000), post('post-3', 3000)])),
      'channel-1'
    );
    expect(reconciled.success).toBe(true);
    expect(await listPinnedIds()).toStrictEqual(['post-2', 'post-3']);
  });

  it('should change nothing when the pins cannot be read', async () => {
    await pinsService.pin(post('post-1', 1000));
    const failure: ChatFailure = { kind: 'api', message: 'forbidden' };
    const reconciled = await pinsService.reconcile(transportPinning(Result.err(failure)), 'channel-1');
    expect(reconciled.error).toStrictEqual(failure);
    expect(await listPinnedIds()).toStrictEqual(['post-1']);
  });
});
