import * as fs from 'node:fs';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { describe, expect, it } from 'vitest';

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, '../../../prisma/migrations');

const MEMORY_MIGRATION = '20260918010000_memory_last_used';

const QUEUE_MIGRATION = '20260918040000_queue_last_enqueued';

const migrations = () => {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .sort()
    .filter((name) => fs.existsSync(path.join(MIGRATIONS_DIR, name, 'migration.sql')));
};

const apply = (database: DatabaseSync, name: string) => {
  database.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf8'));
};

/** every migration applied in order, each seed run just before the migration it is keyed by */
const migrateSeeding = (seeds: { [migration: string]: string }) => {
  const database = new DatabaseSync(':memory:');
  for (const name of migrations()) {
    const seed = seeds[name];
    if (seed !== undefined) {
      database.exec(seed);
    }
    apply(database, name);
  }
  return database;
};

describe('the checked-in migrations', () => {
  it('should apply to a store that already holds memories, carrying their write time as their last use (§3.6)', () => {
    const database = migrateSeeding({
      [MEMORY_MIGRATION]: `INSERT INTO "Memory" ("id", "agentUsername", "body", "createdAt", "description") VALUES ('m1', 'mira', 'b', '2026-01-02 03:04:05', 'd')`
    });
    expect(database.prepare('SELECT "createdAt", "lastUsedAt" FROM "Memory"').all()).toEqual([
      { createdAt: '2026-01-02 03:04:05', lastUsedAt: '2026-01-02 03:04:05' }
    ]);
  });

  it('should apply to a store that already holds queue entries, stamping each with its creation time (§5.2)', () => {
    const database = migrateSeeding({
      [QUEUE_MIGRATION]: `INSERT INTO "QueueEntry" ("id", "agentUsername", "channelId", "createdAt", "earliestUnprocessedPostId") VALUES ('q1', 'mira', 'channel-1', '2026-01-02 03:04:05', 'post-1')`
    });
    expect(database.prepare('SELECT "createdAt", "lastEnqueuedAt" FROM "QueueEntry"').all()).toEqual([
      { createdAt: '2026-01-02 03:04:05', lastEnqueuedAt: '2026-01-02 03:04:05' }
    ]);
  });
});
