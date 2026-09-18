import * as fs from 'node:fs';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { describe, expect, it } from 'vitest';

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, '../../../prisma/migrations');

const MEMORY_MIGRATION = '20260918010000_memory_last_used';

const migrations = () => {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .sort()
    .filter((name) => fs.existsSync(path.join(MIGRATIONS_DIR, name, 'migration.sql')));
};

const apply = (database: DatabaseSync, name: string) => {
  database.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf8'));
};

describe('the checked-in migrations', () => {
  it('should apply to a store that already holds memories, carrying their write time as their last use (§3.6)', () => {
    const database = new DatabaseSync(':memory:');
    for (const name of migrations()) {
      if (name === MEMORY_MIGRATION) {
        database.exec(
          `INSERT INTO "Memory" ("id", "agentUsername", "body", "createdAt", "description") VALUES ('m1', 'mira', 'b', '2026-01-02 03:04:05', 'd')`
        );
      }
      apply(database, name);
    }
    expect(database.prepare('SELECT "createdAt", "lastUsedAt" FROM "Memory"').all()).toEqual([
      { createdAt: '2026-01-02 03:04:05', lastUsedAt: '2026-01-02 03:04:05' }
    ]);
  });
});
