import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ConfigService } from '@/config/config.service.ts';
import { PrismaService } from '@/prisma/prisma.service.ts';
import { getModelToken } from '@/prisma/prisma.utils.ts';
import { createConfigServiceMock } from '@/testing/factories/config-service.factory.ts';
import { createMigratedDatabase } from '@/testing/factories/migrated-database.factory.ts';
import type { MigratedDatabase } from '@/testing/factories/migrated-database.factory.ts';

import { TurnsService } from '../turns.service.ts';

describe('TurnsService abandonment against the store (§7.3)', () => {
  let database: MigratedDatabase;
  let turnsService: TurnsService;

  beforeAll(async () => {
    database = createMigratedDatabase();
    const moduleRef = await Test.createTestingModule({
      providers: [
        TurnsService,
        { provide: ConfigService, useValue: createConfigServiceMock({ turns: { chainLengthLimit: 10 } }) },
        { provide: PrismaService, useValue: database.client },
        { provide: getModelToken('Turn'), useValue: database.client.turn },
        { provide: getModelToken('TurnEvent'), useValue: database.client.turnEvent }
      ]
    }).compile();
    turnsService = moduleRef.get(TurnsService);
  });

  afterAll(() => database.dispose());

  const open = async (triggeringPostId?: string) => {
    const opened = await turnsService.open({
      agentUsername: 'mira',
      chainLength: 1,
      channelId: 'channel-1',
      depth: 0,
      modelName: 'deepseek-v4-flash',
      rootPostId: triggeringPostId ?? 'post-root',
      triggeringPostId
    });
    return opened.unwrap();
  };

  const statusOf = async (turnId: string) => {
    return (await database.client.turn.findUniqueOrThrow({ where: { id: turnId } })).status;
  };

  it('should abandon exactly the running turns and name the status posts they left behind', async () => {
    const running = await open();
    await turnsService.recordStatusPost(running.id, 'status-1');
    const traceless = await open();
    const done = await open();
    await turnsService.close(done.id, 'completed');

    const abandoned = await turnsService.abandonRunning();
    expect(abandoned.statusPosts).toStrictEqual([
      { agentUsername: 'mira', channelId: 'channel-1', postId: 'status-1' }
    ]);
    expect(abandoned.turns.map(({ turnId }) => turnId).toSorted()).toStrictEqual([running.id, traceless.id].toSorted());
    expect(abandoned.unacted).toStrictEqual([]);
    expect(await statusOf(running.id)).toBe('abandoned');
    expect(await statusOf(traceless.id)).toBe('abandoned');
    expect(await statusOf(done.id)).toBe('completed');
  });

  it('should name a turn that recorded no completion as unacted, with the post that started it', async () => {
    const steered = await open('post-1');
    await turnsService.appendEvent(steered.id, { byUsername: 'ada', kind: 'steering_received', text: 'and this' });
    expect((await turnsService.abandonRunning()).unacted).toStrictEqual([
      { agentUsername: 'mira', channelId: 'channel-1', triggeringPostId: 'post-1' }
    ]);
  });

  it('should not name a turn that had dispatched a call, though no result was recorded', async () => {
    const parked = await open('post-2');
    await turnsService.appendEvent(parked.id, {
      content: '',
      kind: 'assistant_message',
      toolCalls: [{ args: { path: 'notes.md' }, callId: 'call-1', toolName: ['workspace', 'write'] }]
    });
    expect((await turnsService.abandonRunning()).unacted).toStrictEqual([]);
  });
});
