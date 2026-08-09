import * as fs from 'node:fs';
import * as path from 'node:path';

import { defineConfig, env } from 'prisma/config';

// instance files (.env, config.json, docker-compose.yaml) live at the workspace root, not in the package
const ENV_FILEPATH = path.resolve(import.meta.dirname, '../.env');

if (fs.existsSync(ENV_FILEPATH)) {
  process.loadEnvFile(ENV_FILEPATH);
}

// SQLite creates a missing database file but never its parent directory, so without this a fresh
// host would need a manual mkdir before its first `prisma migrate deploy`
const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl?.startsWith('file:')) {
  fs.mkdirSync(path.dirname(path.resolve(databaseUrl.slice('file:'.length))), { recursive: true });
}

export default defineConfig({
  datasource: {
    url: env('DATABASE_URL')
  },
  migrations: {
    path: path.join(import.meta.dirname, 'prisma/migrations')
  },
  schema: path.join(import.meta.dirname, 'prisma/schema.prisma')
});
