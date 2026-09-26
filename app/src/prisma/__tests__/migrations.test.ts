import * as fs from 'node:fs';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { describe, expect, it } from 'vitest';

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, '../../../prisma/migrations');

const MEMORY_MIGRATION = '20260918010000_memory_last_used';

const QUEUE_MIGRATION = '20260918040000_queue_last_enqueued';

const UNIT_KIND_MIGRATION = '20260926120000_post_kind_unit';

const QUEUE_ROWS_MIGRATION = '20260926130000_queue_rows';

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
    expect(database.prepare('SELECT "enqueuedAt", "postId" FROM "QueueEntry"').all()).toEqual([
      { enqueuedAt: '2026-01-02 03:04:05', postId: 'post-1' }
    ]);
  });

  it('should turn each standing pointer into one untaken row for the post it named (§5.2)', () => {
    const database = migrateSeeding({
      [QUEUE_ROWS_MIGRATION]: `INSERT INTO "QueueEntry" ("id", "agentUsername", "channelId", "createdAt", "earliestUnprocessedPostId", "lastEnqueuedAt") VALUES ('q1', 'mira', 'channel-1', '2026-01-02 03:04:05', 'post-1', '2026-01-02 04:05:06')`
    });
    expect(
      database
        .prepare(
          'SELECT "agentUsername", "channelId", "enqueuedAt", "postId", "returnedOnce", "takenByTurnId" FROM "QueueEntry"'
        )
        .all()
    ).toEqual([
      {
        agentUsername: 'mira',
        channelId: 'channel-1',
        enqueuedAt: '2026-01-02 04:05:06',
        postId: 'post-1',
        returnedOnce: 0,
        takenByTurnId: null
      }
    ]);
  });

  it('should mark the work-unit posts recorded as notices as unit posts, and no failure notice (§3.15)', () => {
    const notice = (id: string, message: string) =>
      `INSERT INTO "Post" ("id", "authorKind", "authorUsername", "channelId", "createdAt", "kind", "message") VALUES ('${id}', 'agent', 'mira', 'channel-1', '2026-01-02 03:04:05', 'notice', '${message}');`;
    const database = migrateSeeding({
      [UNIT_KIND_MIGRATION]: [
        notice('assign', '@owen — work unit `abcd1234`\n\n**Outcome:** a schedule'),
        notice('report', '@mira — unit `abcd1234` is ready for review: done'),
        notice('blocked', '@mira — unit `abcd1234` is blocked: no access'),
        notice('close', 'Unit `abcd1234` closed as done: checked'),
        notice('failure', 'I ran out of room in this turn, so I stopped.')
      ].join('\n')
    });
    expect(database.prepare('SELECT "id", "kind" FROM "Post" ORDER BY "id"').all()).toEqual([
      { id: 'assign', kind: 'unit' },
      { id: 'blocked', kind: 'unit' },
      { id: 'close', kind: 'unit' },
      { id: 'failure', kind: 'notice' },
      { id: 'report', kind: 'unit' }
    ]);
  });
});
