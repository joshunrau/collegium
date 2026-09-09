import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

import { E2E_RESOURCE_PREFIX } from './constants.ts';
import { exec } from './utils/exec.utils.ts';

/** a migrated, empty store; every harness starts from a copy of it rather than running the migrations itself */
type DatabaseTemplate = {
  path: string;
};

async function createDatabaseTemplate(): Promise<{ dispose: () => Promise<void>; template: DatabaseTemplate }> {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), `${E2E_RESOURCE_PREFIX}-template-`));
  const databasePath = path.join(directory, 'collegium.db');
  await exec('npx', ['prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: pathToFileURL(databasePath).href }
  });
  return {
    dispose: () => fs.promises.rm(directory, { force: true, recursive: true }),
    template: { path: databasePath }
  };
}

function copyDatabaseTemplate(template: DatabaseTemplate, destination: string): void {
  fs.copyFileSync(template.path, destination);
}

export { copyDatabaseTemplate, createDatabaseTemplate };
export type { DatabaseTemplate };
