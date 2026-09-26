import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { isUniqueConstraintViolation } from '@/prisma/prisma.utils.ts';
import { createMigratedDatabase } from '@/testing/factories/migrated-database.factory.ts';
import type { MigratedDatabase } from '@/testing/factories/migrated-database.factory.ts';

describe('the generated Prisma client', () => {
  let database: MigratedDatabase;

  beforeAll(() => {
    database = createMigratedDatabase();
  });

  afterAll(() => database.dispose());

  it('should round-trip a row against a database built from the migrations', async () => {
    const created = await database.client.queueEntry.create({
      data: { agentUsername: 'mira', channelId: 'channel-1', enqueuedAt: new Date(0), postId: 'post-1' }
    });
    const found = await database.client.queueEntry.findUniqueOrThrow({ where: { id: created.id } });
    expect(found).toStrictEqual(created);
  });

  it('should refuse a second queue row for one post in one lane, which an insert ignores (§5.2)', async () => {
    const row = { agentUsername: 'owen', channelId: 'channel-1', enqueuedAt: new Date(0), postId: 'post-1' };
    await database.client.queueEntry.create({ data: row });
    const repeated = await database.client.queueEntry.create({ data: row }).catch((error: unknown) => error);
    expect(isUniqueConstraintViolation(repeated)).toBe(true);
  });
});
