import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ConfigService } from '@/config/config.service.ts';
import { PrismaService } from '@/prisma/prisma.service.ts';
import { getModelToken } from '@/prisma/prisma.utils.ts';
import { createConfigServiceMock } from '@/testing/factories/config-service.factory.ts';
import { createMigratedDatabase } from '@/testing/factories/migrated-database.factory.ts';
import type { MigratedDatabase } from '@/testing/factories/migrated-database.factory.ts';

import { TurnsService } from '../turns.service.ts';

describe('TurnsService’s record of a turn for its trace, against the store (§8.3)', () => {
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

  const open = async () => {
    const opened = await turnsService.open({
      activationKind: 'handoff',
      agentUsername: 'mira',
      chainLength: 2,
      channelId: 'channel-1',
      depth: 1,
      drainedFromPostId: 'post-3',
      modelName: 'deepseek-v4-flash',
      rootPostId: 'post-1',
      triggeringPostId: 'post-3'
    });
    return opened.unwrap();
  };

  it('should keep what started the turn and the window it last read on its row', async () => {
    const turn = await open();
    await turnsService.recordAssembledWindow(turn.id, {
      assembledAt: new Date('2026-01-01T00:00:01.000Z'),
      estimatedTokens: 3200,
      oldestAt: new Date('2025-12-31T23:00:00.000Z')
    });
    expect(await database.client.turn.findUniqueOrThrow({ where: { id: turn.id } })).toMatchObject({
      activationKind: 'handoff',
      contextAssembledAt: new Date('2026-01-01T00:00:01.000Z'),
      drainedFromPostId: 'post-3',
      windowEstimatedTokens: 3200,
      windowOldestAt: new Date('2025-12-31T23:00:00.000Z')
    });
  });

  it('should merge how the model read a result into its event, leaving the output whole (§3.8)', async () => {
    const turn = await open();
    const { id: eventId } = await turnsService.appendEvent(turn.id, {
      callId: 'c1',
      kind: 'tool_result',
      output: 'a long page',
      toolName: ['web', 'fetch']
    });
    await turnsService.recordPresentation(eventId, { shownChars: 4 });
    await turnsService.recordPresentation(eventId, { collapsed: true });
    const [event] = await turnsService.listEvents(turn.id);
    expect(event?.payload).toStrictEqual({
      callId: 'c1',
      kind: 'tool_result',
      output: 'a long page',
      presentedAs: { collapsed: true, shownChars: 4 },
      toolName: ['web', 'fetch']
    });
  });
});
