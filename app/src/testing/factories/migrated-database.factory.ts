import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

import { PrismaClient } from '@/prisma/generated/client.ts';

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, '../../../prisma/migrations');

export type MigratedDatabase = {
  client: PrismaClient;
  dispose: () => Promise<void>;
};

/** a client over a fresh SQLite file built from the checked-in migrations, the only description of the schema */
export function createMigratedDatabase(): MigratedDatabase {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'collegium-prisma-'));
  const databasePath = path.join(directory, 'collegium.db');
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
  const client = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: pathToFileURL(databasePath).href }) });
  return {
    client,
    dispose: async () => {
      await client.$disconnect();
      fs.rmSync(directory, { force: true, recursive: true });
    }
  };
}
