import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { toErrorMessage } from '@collegium/core/utils';

import { E2E_RESOURCE_PREFIX } from './constants.ts';
import { exec } from './utils/exec.utils.ts';
import { PENDING, waitFor } from './utils/wait.utils.ts';

type ClusterConnection = {
  admin: {
    password: string;
    username: string;
  };
  containerId: string;
  publicHost: string;
  teamName: string;
  url: string;
};

type MmctlRunner = (args: string[]) => Promise<string>;

/** the one name Docker gives a container for the host it runs on; compose stamps it into every service */
const DOCKER_HOST_ALIAS = 'host.docker.internal';

/** where Mattermost opens its local-mode socket, the transport every mmctl call below uses */
const LOCAL_MODE_SOCKET = '/var/tmp/mattermost_local.socket';

const COMPOSE_FILE = path.resolve(import.meta.dirname, '../compose.yaml');
const IMAGE_CONTEXT = path.resolve(import.meta.dirname, '../mattermost');

const MATTERMOST_PORT = Number(process.env.E2E_MATTERMOST_PORT ?? 8065);

const CLUSTER_FIXTURE = {
  admin: {
    email: 'e2e-admin@example.com',
    firstName: 'E2E',
    lastName: 'Admin',
    password: 'E2e-password-123!',
    username: 'e2e-admin'
  },
  port: MATTERMOST_PORT,
  team: {
    displayName: 'Collegium E2E',
    name: E2E_RESOURCE_PREFIX
  },
  url: `http://localhost:${MATTERMOST_PORT}`,
  version: '11.7.7'
} as const;

function toImageTag(): string {
  const hash = createHash('sha256');
  for (const filename of fs.readdirSync(IMAGE_CONTEXT).sort()) {
    hash.update(filename).update(fs.readFileSync(path.join(IMAGE_CONTEXT, filename)));
  }
  return `collegium-e2e-mattermost:${CLUSTER_FIXTURE.version}-${hash.digest('hex').slice(0, 8)}`;
}

const IMAGE_TAG = toImageTag();

const CLUSTER_TIMEOUTS = {
  build: 300_000,
  command: 20_000,
  startup: 120_000
} as const;

const CONTAINER_ID_PATTERN = /\b[0-9a-f]{12,64}\b/;

async function bootstrapCluster(mmctl: MmctlRunner): Promise<void> {
  await mmctl([
    'user',
    'create',
    '--email',
    CLUSTER_FIXTURE.admin.email,
    '--email-verified',
    '--firstname',
    CLUSTER_FIXTURE.admin.firstName,
    '--lastname',
    CLUSTER_FIXTURE.admin.lastName,
    '--password',
    CLUSTER_FIXTURE.admin.password,
    '--system-admin',
    '--username',
    CLUSTER_FIXTURE.admin.username
  ]);
  await mmctl([
    'team',
    'create',
    '--display-name',
    CLUSTER_FIXTURE.team.displayName,
    '--email',
    CLUSTER_FIXTURE.admin.email,
    '--name',
    CLUSTER_FIXTURE.team.name
  ]);
  await mmctl(['team', 'users', 'add', CLUSTER_FIXTURE.team.name, CLUSTER_FIXTURE.admin.username]);
}

/** the image compose then runs: tagged by the hash of its build context, so a rebuild is never repeated */
async function ensureImage(): Promise<void> {
  const exists = await runDocker(['image', 'inspect', IMAGE_TAG], CLUSTER_TIMEOUTS.command).then(
    () => true,
    () => false
  );
  if (exists) {
    return;
  }
  await runDocker(
    ['build', '--tag', IMAGE_TAG, '--build-arg', `MATTERMOST_VERSION=${CLUSTER_FIXTURE.version}`, IMAGE_CONTEXT],
    CLUSTER_TIMEOUTS.build
  );
}

function mmctl(containerId: string, args: string[]): Promise<string> {
  return runDocker(['exec', containerId, 'mmctl', '--local', '--suppress-warnings', ...args], CLUSTER_TIMEOUTS.command);
}

async function readMattermostLogs(containerId: string): Promise<string> {
  return runDocker(['logs', containerId], CLUSTER_TIMEOUTS.command).catch((error: unknown) => {
    return toErrorMessage(error);
  });
}

function runDocker(args: string[], timeoutMs: number): Promise<string> {
  return exec('docker', args, { timeoutMs });
}

/** Mattermost answers the ping before it opens the socket, and bootstrapping is all mmctl */
async function waitUntilAvailable(containerId: string): Promise<void> {
  await waitFor({
    describeFailure: () => readMattermostLogs(containerId),
    description: `Mattermost to answer /api/v4/system/ping at ${CLUSTER_FIXTURE.url} and open ${LOCAL_MODE_SOCKET}`,
    probe: async () => {
      const status = await fetch(`${CLUSTER_FIXTURE.url}/api/v4/system/ping`)
        .then((response) => (response.ok ? (response.json() as Promise<{ status?: string }>) : undefined))
        .catch(() => undefined);
      if (status?.status !== 'OK') {
        return PENDING;
      }
      const opened = await runDocker(['exec', containerId, 'test', '-S', LOCAL_MODE_SOCKET], CLUSTER_TIMEOUTS.command)
        .then(() => true)
        .catch(() => false);
      return opened ? true : PENDING;
    },
    timeoutMs: CLUSTER_TIMEOUTS.startup
  });
}

class MattermostCluster {
  private readonly projectName = `${E2E_RESOURCE_PREFIX}-${process.pid}-${Date.now()}`;

  async start(): Promise<ClusterConnection> {
    await ensureImage();
    await this.compose(['up', '--detach', '--wait'], CLUSTER_TIMEOUTS.startup);
    const containerId = await this.readContainerId();
    await waitUntilAvailable(containerId);
    await bootstrapCluster((args) => mmctl(containerId, args));
    return {
      admin: {
        password: CLUSTER_FIXTURE.admin.password,
        username: CLUSTER_FIXTURE.admin.username
      },
      containerId,
      publicHost: DOCKER_HOST_ALIAS,
      teamName: CLUSTER_FIXTURE.team.name,
      url: CLUSTER_FIXTURE.url
    };
  }

  async stop(): Promise<void> {
    await this.compose(['down', '--remove-orphans', '--volumes'], CLUSTER_TIMEOUTS.command).catch(() => undefined);
  }

  private compose(args: string[], timeoutMs: number): Promise<string> {
    return exec('docker', ['compose', '--file', COMPOSE_FILE, '--project-name', this.projectName, ...args], {
      env: {
        ...process.env,
        E2E_MATTERMOST_IMAGE: IMAGE_TAG,
        E2E_MATTERMOST_PORT: String(CLUSTER_FIXTURE.port)
      },
      timeoutMs
    });
  }

  private async readContainerId(): Promise<string> {
    const listed = await this.compose(['ps', '--quiet', 'mattermost'], CLUSTER_TIMEOUTS.command);
    const containerId = CONTAINER_ID_PATTERN.exec(listed)?.[0];
    if (!containerId) {
      throw new Error(`compose project ${this.projectName} listed no mattermost container:\n${listed}`);
    }
    return containerId;
  }
}

export { MattermostCluster, readMattermostLogs };
export type { ClusterConnection };
