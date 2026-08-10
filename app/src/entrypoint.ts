/**
 * Everything a host used to be responsible for, done once per container start: the §A2 OS users, the
 * sudoers grant, the schema, and dropping out of root. Root does all of its work first and drops
 * once, irreversibly; the app is then this process rather than a child of it, so the container's
 * SIGTERM reaches it directly and a turn in flight can unwind.
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { $Config } from '@/config/config.schemas.ts';
import { $Env } from '@/config/env/env.schemas.ts';
// the root prologue predates DI, so it reaches for the adapter itself; a boot failure must still land as JSON
// eslint-disable-next-line @typescript-eslint/no-restricted-imports
import { JSONLogger } from '@/logging/adapters/json.logger.ts';
import { SHELL_TOOL_NAME } from '@/shell/shell.constants.ts';
import { deriveShellOsUser } from '@/shell/shell.utils.ts';

const AGENT_GROUP = 'collegium-agents';
const APP_USER = 'app';
const HOME_DIR = '/home';
const STAGED_CONFIG = '/run/collegium/config.json';
const SUDOERS_FILE = '/etc/sudoers.d/collegium';

// fixed, because the entrypoint claims the mounted state itself: no host uid to match, nothing to choose
const APP_GID = 10_001;
const APP_UID = 10_001;

function run(command: string, args: string[]): void {
  execFileSync(command, args, { stdio: 'inherit' });
}

function succeeds(command: string, args: string[]): boolean {
  try {
    execFileSync(command, args, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function belongsToAgentGroup(osUser: string): boolean {
  const groups = execFileSync('id', ['--groups', '--name', osUser], { encoding: 'utf-8' });
  return groups.trim().split(/\s+/).includes(AGENT_GROUP);
}

function provisionAgentOsUser(osUser: string): void {
  const home = path.join(HOME_DIR, osUser);
  if (succeeds('id', ['--user', osUser])) {
    // agent-group membership marks the account as an earlier start's own provisioning — a container
    // restart, not a collision; an account the image itself holds would never carry it
    if (!belongsToAgentGroup(osUser)) {
      throw new Error(`"${osUser}" collides with an account the image already holds; rename the agent`);
    }
  } else {
    const existing = fs.statSync(home, { throwIfNoEntry: false });
    if (existing) {
      // accounts live in the image and homes live in the volume, so an agent's ids are whatever its
      // own home already carries: fresh numbers would hand it the home of whoever held them before
      if (!succeeds('getent', ['group', String(existing.gid)])) {
        run('groupadd', ['--gid', String(existing.gid), osUser]);
      }
      const ids = ['--uid', String(existing.uid), '--gid', String(existing.gid)];
      run('useradd', [...ids, '--groups', AGENT_GROUP, '--shell', '/bin/bash', osUser]);
    } else {
      run('useradd', ['--create-home', '--user-group', '--groups', AGENT_GROUP, '--shell', '/bin/bash', osUser]);
    }
  }
  fs.chmodSync(home, 0o700);
}

const logger = new JSONLogger('Entrypoint');

try {
  if (process.getuid?.() !== 0) {
    throw new Error('the entrypoint provisions OS users and must start as root; do not set a container user');
  }
  if (!process.setgid || !process.setgroups || !process.setuid) {
    throw new Error('the entrypoint drops privileges and runs on POSIX platforms only');
  }

  const env = $Env.parse(process.env);

  // Docker materialises a bind mount whose host path does not exist as an empty directory
  if (!fs.statSync(env.CONFIG_PATH, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`"${env.CONFIG_PATH}" is not a file; does the mounted config.json exist on the host?`);
  }
  const config = $Config.parse(JSON.parse(fs.readFileSync(env.CONFIG_PATH, 'utf-8')));

  if (!succeeds('id', ['--user', APP_USER])) {
    run('groupadd', ['--gid', String(APP_GID), APP_USER]);
    run('useradd', ['--uid', String(APP_UID), '--gid', String(APP_GID), '--create-home', APP_USER]);
  }

  // the mounted config holds API keys and is sensibly 0600 on the host, which the app's uid could not
  // read; root stages a copy of its own instead
  fs.mkdirSync(path.dirname(STAGED_CONFIG), { recursive: true });
  fs.chownSync(path.dirname(STAGED_CONFIG), 0, APP_GID);
  fs.chmodSync(path.dirname(STAGED_CONFIG), 0o750);
  fs.copyFileSync(env.CONFIG_PATH, STAGED_CONFIG);
  fs.chownSync(STAGED_CONFIG, APP_UID, APP_GID);
  fs.chmodSync(STAGED_CONFIG, 0o400);
  process.env.CONFIG_PATH = STAGED_CONFIG;

  // recursive, because a directory arriving from the host — a restored backup, one the operator made —
  // carries whatever ownership it was made with
  const databaseDirectory = path.dirname(fileURLToPath(env.DATABASE_URL));
  for (const stateDirectory of [databaseDirectory, env.WORKSPACE_ROOT]) {
    // the recursion below is the whole reason: rooted here it would re-own the entire container,
    // bind-mounted host files included, and then make / untraversable to the app that follows
    const resolved = path.resolve(stateDirectory);
    if (resolved === path.parse(resolved).root) {
      throw new Error(`"${stateDirectory}" is the filesystem root; state must live in a directory of its own`);
    }
    fs.mkdirSync(stateDirectory, { recursive: true });
    run('chown', ['--recursive', `${APP_UID}:${APP_GID}`, stateDirectory]);
    fs.chmodSync(stateDirectory, 0o700);
  }

  const osUsers = config.agents
    .filter((agent) => agent.tools.includes(SHELL_TOOL_NAME))
    .map((agent) => deriveShellOsUser(agent.username));

  if (osUsers.length > 0) {
    if (!succeeds('getent', ['group', AGENT_GROUP])) {
      run('groupadd', [AGENT_GROUP]);
    }
    for (const osUser of osUsers) {
      provisionAgentOsUser(osUser);
    }
    fs.writeFileSync(SUDOERS_FILE, `${APP_USER} ALL=(%${AGENT_GROUP}) NOPASSWD: ALL\n`, { mode: 0o440 });
  }

  // §6.1: denying traversal of /app is the whole of the framework's confinement — nothing beneath it
  // can be reached without the execute bit here
  fs.chownSync('/app', 0, APP_GID);
  fs.chmodSync('/app', 0o750);

  process.env.HOME = path.join(HOME_DIR, APP_USER);
  // root's supplementary groups survive setgid and setuid; the app belongs to nothing but its own
  process.setgroups([APP_GID]);
  process.setgid(APP_GID);
  process.setuid(APP_UID);

  run('node_modules/.bin/prisma', ['migrate', 'deploy']);

  const { bootstrap } = await import('./bootstrap.ts');

  await bootstrap();
} catch (error) {
  // the CrashHandler exists only once the app module is up; a failure before then must still land as JSON
  logger.error(error);
  process.exit(1);
}
