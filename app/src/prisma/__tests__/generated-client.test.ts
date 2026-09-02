import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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
      data: { agentUsername: 'mira', channelId: 'channel-1', earliestUnprocessedPostId: 'post-1' }
    });
    const found = await database.client.queueEntry.findUniqueOrThrow({ where: { id: created.id } });
    expect(found).toStrictEqual(created);
  });
});
