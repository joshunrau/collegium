import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PrismaClient } from '../generated/client.ts';

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, '../../../prisma/migrations');

/** the checked-in migrations are the only description of the schema, so the fixture is built from them */
const migrate = (databasePath: string): void => {
  const database = new DatabaseSync(databasePath);
  try {
    for (const name of fs.readdirSync(MIGRATIONS_DIR).sort()) {
      const migration = path.join(MIGRATIONS_DIR, name, 'migration.sql');
      if (fs.existsSync(migration)) {
        database.exec(fs.readFileSync(migration, 'utf8'));
      }
    }
  } finally {
    database.close();
  }
};

describe('the generated Prisma client', () => {
  let client: PrismaClient;
  let directory: string;

  beforeAll(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'collegium-prisma-'));
    const databasePath = path.join(directory, 'collegium.db');
    migrate(databasePath);
    client = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: pathToFileURL(databasePath).href }) });
  });

  afterAll(async () => {
    await client.$disconnect();
    fs.rmSync(directory, { force: true, recursive: true });
  });

  it('should round-trip a row against a database built from the migrations', async () => {
    const created = await client.queueEntry.create({
      data: { agentUsername: 'mira', channelId: 'channel-1', earliestUnprocessedPostId: 'post-1' }
    });
    const found = await client.queueEntry.findUniqueOrThrow({ where: { id: created.id } });
    expect(found).toStrictEqual(created);
  });
});
