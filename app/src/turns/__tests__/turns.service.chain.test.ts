import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ConfigService } from '@/config/config.service.ts';
import { PrismaService } from '@/prisma/prisma.service.ts';
import { getModelToken } from '@/prisma/prisma.utils.ts';
import { createConfigServiceMock } from '@/testing/factories/config-service.factory.ts';
import { createMigratedDatabase } from '@/testing/factories/migrated-database.factory.ts';
import type { MigratedDatabase } from '@/testing/factories/migrated-database.factory.ts';

import { TurnsService } from '../turns.service.ts';

const CHAIN_LENGTH_LIMIT = 3;

describe('TurnsService admission against the store (§7.4)', () => {
  let database: MigratedDatabase;
  let turnsService: TurnsService;

  beforeAll(async () => {
    database = createMigratedDatabase();
    const moduleRef = await Test.createTestingModule({
      providers: [
        TurnsService,
        {
          provide: ConfigService,
          useValue: createConfigServiceMock({ turns: { chainLengthLimit: CHAIN_LENGTH_LIMIT } })
        },
        { provide: PrismaService, useValue: database.client },
        { provide: getModelToken('Turn'), useValue: database.client.turn },
        { provide: getModelToken('TurnEvent'), useValue: database.client.turnEvent }
      ]
    }).compile();
    turnsService = moduleRef.get(TurnsService);
  });

  afterAll(() => database.dispose());

  const open = (rootPostId: string) => {
    return turnsService.open({
      activationKind: 'addressed',
      agentUsername: 'mira',
      chainLength: 1,
      channelId: 'channel-1',
      depth: 0,
      modelName: 'deepseek-v4-flash',
      rootPostId
    });
  };

  it('should open exactly one of two turns racing to join a chain one short of the limit', async () => {
    for (let index = 0; index < CHAIN_LENGTH_LIMIT - 1; index += 1) {
      expect((await open('post-race')).success).toBe(true);
    }
    const outcomes = await Promise.all([open('post-race'), open('post-race')]);
    expect(outcomes.map((outcome) => outcome.success).toSorted()).toStrictEqual([false, true]);
    expect(await turnsService.countInChain('post-race')).toBe(CHAIN_LENGTH_LIMIT);
  });

  it('should leave a different chain untouched by a full one', async () => {
    expect((await open('post-other')).success).toBe(true);
    expect(await turnsService.countInChain('post-other')).toBe(1);
  });
});
