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

import { $Config, $Env } from '@collegium/config';

// the root prologue predates DI, so it reaches for the adapter itself; a boot failure must still land as JSON
// eslint-disable-next-line @typescript-eslint/no-restricted-imports
import { JSONLogger } from '@/logging/adapters/json.logger.ts';
import type { ShellOsIdentity } from '@/shell/shell.types.ts';
import { deriveShellOsIdentities, holdsShellGrant } from '@/shell/shell.utils.ts';

const AGENT_GROUP = 'collegium-agents';
// what provisioning authenticates with, and what the long-lived app process must never hold
const ADMIN_ENV_PREFIX = 'MATTERMOST_ADMIN_';
// the whole tree the image installs — the app package, the workspace packages it imports, and the
// node_modules both resolve through — plus the plugin root mounted beneath it, which is what puts
// operator-supplied code behind the same denial as the framework's own. It tracks the Dockerfile,
// and a move that leaves this behind confines a directory the app no longer lives in.
const APP_ROOT = '/srv';
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

function provisionAgentOsUser({ id, osUser }: ShellOsIdentity): void {
  const home = path.join(HOME_DIR, osUser);
  if (succeeds('id', ['--user', osUser])) {
    // agent-group membership marks the account as an earlier start's own provisioning — a container
    // restart, not a collision; an account the image itself holds would never carry it
    if (!belongsToAgentGroup(osUser)) {
      throw new Error(`"${osUser}" collides with an account the image already holds; rename the agent`);
    }
  } else {
    if (succeeds('getent', ['passwd', String(id)])) {
      throw new Error(`"${osUser}" derives id ${id}, which an account the image already holds; rename the agent`);
    }
    if (!succeeds('getent', ['group', String(id)])) {
      run('groupadd', ['--gid', String(id), osUser]);
    }
    const hasHome = fs.statSync(home, { throwIfNoEntry: false }) !== undefined;
    const create = hasHome ? [] : ['--create-home'];
    const ids = ['--uid', String(id), '--gid', String(id)];
    run('useradd', [...create, ...ids, '--groups', AGENT_GROUP, '--shell', '/bin/bash', osUser]);
  }
  // ownership is claimed from the derived id every start and never read back off the volume: a mount
  // that synthesizes it — Docker Desktop reports whatever the caller is — would answer with a lie
  fs.mkdirSync(home, { recursive: true });
  run('chown', ['--recursive', `${id}:${id}`, home]);
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

  const identities = deriveShellOsIdentities(
    config.agents.filter((agent) => holdsShellGrant(agent.tools)).map((agent) => agent.username)
  );

  if (identities.length > 0) {
    if (!succeeds('getent', ['group', AGENT_GROUP])) {
      run('groupadd', [AGENT_GROUP]);
    }
    for (const identity of identities) {
      provisionAgentOsUser(identity);
    }
    fs.writeFileSync(SUDOERS_FILE, `${APP_USER} ALL=(%${AGENT_GROUP}) NOPASSWD: ALL\n`, { mode: 0o440 });
  }

  // §6.1: denying traversal of the app root is the whole of the framework's confinement — nothing
  // beneath it can be reached without the execute bit here
  fs.chownSync(APP_ROOT, 0, APP_GID);
  fs.chmodSync(APP_ROOT, 0o750);

  process.env.HOME = path.join(HOME_DIR, APP_USER);
  // root's supplementary groups survive setgid and setuid; the app belongs to nothing but its own
  process.setgroups([APP_GID]);
  process.setgid(APP_GID);
  process.setuid(APP_UID);

  run('node_modules/.bin/prisma', ['migrate', 'deploy']);

  // Provisioning converges Mattermost onto the configuration; boot then refuses anything that does
  // not match. Separate processes because a verifier that validates its own writes verifies nothing
  // — and because the administrator's credentials die here, before the app that runs for months.
  run(process.execPath, ['dist/provision.js']);
  for (const key of Object.keys(process.env)) {
    if (key.startsWith(ADMIN_ENV_PREFIX)) {
      delete process.env[key];
    }
  }

  const { bootstrap } = await import('./bootstrap.ts');

  await bootstrap();
} catch (error) {
  // the CrashHandler exists only once the app module is up; a failure before then must still land as JSON
  logger.error(error);
  process.exit(1);
}
