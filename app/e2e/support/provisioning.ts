import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

import { Client4 } from '@mattermost/client';
import { NestFactory } from '@nestjs/core';
import { afterAll, beforeAll, inject } from 'vitest';

import { ProvisionModule } from '@/provision.module.ts';
import { ProvisioningService } from '@/provisioning/provisioning.service.ts';

import { E2E_RESOURCE_PREFIX } from './constants.ts';
import { exec } from './utils/exec.utils.ts';
import { createWorkspaceId } from './utils/naming.utils.ts';

/** creating accounts and minting their tokens is several round trips per bot, once per run */
const PROVISIONING_TIMEOUT = 120_000;

/** the channel every Mattermost team has, and the default `mattermost.mainChannel` resolves to */
const MAIN_CHANNEL = 'town-square';

/** what the store holds for one account: the whole of what provisioning is trusted to keep */
type ProvisionedCredential = {
  token: string;
  username: string;
};

type Provisioning = {
  /** the username a minted token actually authenticates as */
  identify: (token: string) => Promise<string>;
  isMainChannelMember: (username: string) => Promise<boolean>;
  /** the store's contents after each run, in order */
  runs: readonly (readonly ProvisionedCredential[])[];
  usernames: { agent: string; systemBot: string };
};

function readCredentials(databasePath: string): ProvisionedCredential[] {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const rows = database.prepare('SELECT username, token FROM MattermostCredential ORDER BY username').all();
    return rows.map((row) => ({ token: String(row.token), username: String(row.username) }));
  } finally {
    database.close();
  }
}

/**
 * Runs the real provisioner against the suite's Mattermost, `runs` times over. Its accounts are named
 * for this run alone, so the shared cluster admits any number of them without collision.
 */
export function setupProvisioning(options: { runs: number }): Provisioning {
  const cluster = inject('cluster');
  const workspaceId = createWorkspaceId();
  const usernames = { agent: `${workspaceId}-vera`, systemBot: `${workspaceId}-orch` };

  const runs: ProvisionedCredential[][] = [];
  let adminClient: Client4;
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `${E2E_RESOURCE_PREFIX}-provisioning-`));
    const configPath = path.join(tmpDir, 'config.json');
    const databasePath = path.join(tmpDir, 'collegium.db');
    const databaseUrl = pathToFileURL(databasePath).href;

    fs.writeFileSync(
      configPath,
      JSON.stringify({
        agents: [
          {
            expertise: 'provisioning',
            model: { name: 'deepseek-v4-flash', provider: 'deepseek' },
            systemPrompt: 'You are Vera.',
            tools: [],
            username: usernames.agent
          }
        ],
        mattermost: { systemBotUsername: usernames.systemBot },
        models: { deepseek: { apiKey: 'never-called' } }
      })
    );
    await exec('npx', ['prisma', 'migrate', 'deploy'], { env: { ...process.env, DATABASE_URL: databaseUrl } });

    Object.assign(process.env, {
      APP_HOST: '127.0.0.1',
      APP_PORT: '3000',
      CONFIG_PATH: configPath,
      DATABASE_URL: databaseUrl,
      MATTERMOST_TEAM: cluster.teamName,
      MATTERMOST_URL: cluster.url,
      WORKSPACE_ROOT: path.join(tmpDir, 'workspaces')
    });

    for (let attempt = 0; attempt < options.runs; attempt++) {
      const context = await NestFactory.createApplicationContext(ProvisionModule, { logger: false });
      try {
        await context.get(ProvisioningService).reconcile({
          email: `${workspaceId}@example.com`,
          password: cluster.admin.password,
          username: cluster.admin.username
        });
      } finally {
        await context.close();
      }
      runs.push(readCredentials(databasePath));
    }

    adminClient = new Client4();
    adminClient.setUrl(cluster.url);
    await adminClient.login(cluster.admin.username, cluster.admin.password);
  }, PROVISIONING_TIMEOUT);

  afterAll(() => {
    fs.rmSync(tmpDir, { force: true, recursive: true });
  });

  return {
    identify: async (token) => {
      const client = new Client4();
      client.setUrl(cluster.url);
      client.setToken(token);
      const profile = await client.getMe();
      return profile.username;
    },
    isMainChannelMember: async (username) => {
      const team = await adminClient.getTeamByName(cluster.teamName);
      const [channel, user] = await Promise.all([
        adminClient.getChannelByName(team.id, MAIN_CHANNEL),
        adminClient.getUserByUsername(username)
      ]);
      return adminClient
        .getChannelMember(channel.id, user.id)
        .then(() => true)
        .catch(() => false);
    },
    runs,
    usernames
  };
}
