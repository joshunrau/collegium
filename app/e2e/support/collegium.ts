import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

import { withTimeout } from '@collegium/core/utils';

import { CONFIG_DEFAULTS } from '@/config/config.constants.ts';
import type { Config } from '@/config/config.schemas.ts';

import { E2E_RESOURCE_PREFIX, PROJECT_ROOT } from './constants.ts';
import { InferenceStub, textResponse } from './inference.ts';
import { exec } from './utils/exec.utils.ts';
import { PENDING, ProbeAbortError, waitFor } from './utils/wait.utils.ts';

import type { Channel } from './channel.ts';
import type { Scenario } from './scenario.ts';
import type { AgentBot, WorkspaceChannel } from './workspace.ts';

const COLLEGIUM_FIXTURE = {
  /** the app binds beyond the loopback so the Mattermost container can reach its callbacks */
  bindHost: '0.0.0.0',
  configFilename: 'config.json',
  databaseFilename: 'collegium.db',
  /** short enough to keep every test fast, long enough that deliberate fragment tests can fold */
  debounce: {
    ceilingMs: 500,
    windowMs: 50
  },
  host: '127.0.0.1',
  /** the production backoff would stretch retry tests; attempts stay at the shipped default */
  inferenceRetry: {
    ...CONFIG_DEFAULTS.app.inferenceRetry,
    backoffMs: 10
  },
  inferenceTimeoutMs: 60_000,
  model: {
    name: 'deepseek-v4-flash',
    provider: 'deepseek'
  }
} as const;

const COLLEGIUM_TIMEOUTS = {
  handshake: 30_000,
  shutdown: 5000,
  startup: 30_000
} as const;

type CollegiumConfigOptions = {
  agents: ReadonlyMap<string, AgentBot>;
  channels: ReadonlyMap<string, WorkspaceChannel>;
  inference: { apiKey: string; baseUrl: string };
  mainChannel: string;
  scenario: Scenario;
  systemBotUsername: string;
};

type CollegiumProcessOptions = {
  config: Config;
  /** what the workspace minted: the app reads its tokens from the store provisioning writes */
  credentials: readonly AgentBot[];
  mattermost: {
    teamName: string;
    url: string;
  };
  port: number;
  /** Mattermost runs in a container and reaches the app on the host only by this address */
  publicHost: string;
};

type HandshakeOptions<AgentName extends string> = {
  agent: AgentName;
  channel: Channel<AgentName>;
  inference: InferenceStub;
};

function hasExited(child: ChildProcessWithoutNullStreams): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

function waitUntilExited(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (hasExited(child)) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    child.once('exit', () => resolve());
  });
}

function buildCollegiumConfig({
  agents,
  channels,
  inference,
  mainChannel,
  scenario,
  systemBotUsername
}: CollegiumConfigOptions): Config {
  return {
    agents: scenario.agents.map((agent) => {
      const bot = agents.get(agent.username);
      if (!bot) {
        throw new Error(`agent "${agent.username}" has no provisioned Mattermost bot`);
      }
      return {
        botToken: bot.token,
        contextBudgetTokens: agent.contextBudgetTokens,
        expertise: agent.expertise,
        memoryCaps: agent.memoryCaps,
        model: COLLEGIUM_FIXTURE.model,
        skills: Array.from(agent.skills ?? []),
        systemPrompt: agent.systemPrompt,
        tools: [...(agent.tools ?? [])],
        username: bot.username
      };
    }),
    app: {
      contextBudgetTokens: CONFIG_DEFAULTS.app.contextBudgetTokens,
      debounce: scenario.debounce ?? COLLEGIUM_FIXTURE.debounce,
      enableLifecycleNotifications: true,
      inferenceRetry: COLLEGIUM_FIXTURE.inferenceRetry,
      inferenceTimeoutMs: COLLEGIUM_FIXTURE.inferenceTimeoutMs,
      logLevel: 'error',
      memoryCaps: CONFIG_DEFAULTS.app.memoryCaps,
      timezone: CONFIG_DEFAULTS.app.timezone,
      turnCeilingPerHour: scenario.turnCeilingPerHour ?? CONFIG_DEFAULTS.app.turnCeilingPerHour
    },
    channels: scenario.channels.flatMap((channel) => {
      if (!channel.triggerMode) {
        return [];
      }
      // config names channels by handle, and a DM has none to name — it is respond-to-all by type (§3.10)
      if (channel.type === 'direct') {
        throw new Error(`direct channel "${channel.name}" cannot declare a trigger mode`);
      }
      const provisioned = channels.get(channel.name);
      if (!provisioned) {
        throw new Error(`channel "${channel.name}" has no provisioned Mattermost channel`);
      }
      return [{ handle: provisioned.name, triggerMode: channel.triggerMode }];
    }),
    mattermost: {
      mainChannel,
      systemBotUsername
    },
    models: {
      deepseek: {
        apiKey: inference.apiKey,
        baseUrl: inference.baseUrl
      }
    },
    plugins: scenario.plugins?.map((plugin) => ({
      ...plugin,
      path: path.isAbsolute(plugin.path) ? plugin.path : path.resolve(PROJECT_ROOT, '..', plugin.path)
    }))
  };
}

async function awaitAgentHandshake<AgentName extends string>({
  agent,
  channel,
  inference
}: HandshakeOptions<AgentName>): Promise<void> {
  const token = `handshake-${randomUUID()}`;
  inference.willReply({ agent, contains: token }, textResponse(token));
  await channel.mention(agent, token);
  await channel.awaitReplyFrom(agent, { text: token, timeoutMs: COLLEGIUM_TIMEOUTS.handshake });
}

class CollegiumProcess {
  private child: ChildProcessWithoutNullStreams | undefined;
  private readonly config: Config;
  private readonly configPath: string;
  private readonly credentials: readonly AgentBot[];
  private readonly databasePath: string;
  private readonly databaseUrl: string;
  private readonly mattermost: { teamName: string; url: string };
  private readonly port: number;
  private readonly publicUrl: string;
  private stderr = '';
  private stdout = '';
  private readonly tmpDir: string;
  private readonly workspaceRoot: string;

  constructor({ config, credentials, mattermost, port, publicHost }: CollegiumProcessOptions) {
    this.credentials = credentials;
    this.mattermost = mattermost;
    this.port = port;
    this.publicUrl = `http://${publicHost}:${port}`;
    this.tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `${E2E_RESOURCE_PREFIX}-`));
    this.config = config;
    this.workspaceRoot = path.join(this.tmpDir, 'workspaces');
    this.configPath = path.join(this.tmpDir, COLLEGIUM_FIXTURE.configFilename);
    this.databasePath = path.join(this.tmpDir, COLLEGIUM_FIXTURE.databaseFilename);
    this.databaseUrl = pathToFileURL(this.databasePath).href;
  }

  get url(): string {
    return `http://${COLLEGIUM_FIXTURE.host}:${this.port}`;
  }

  async dispose(): Promise<void> {
    await this.stop();
    await fs.promises.rm(this.tmpDir, { force: true, recursive: true });
  }

  logs(): string {
    return [`stdout:\n${this.stdout || '  (empty)'}`, `stderr:\n${this.stderr || '  (empty)'}`].join('\n');
  }

  /**
   * Mattermost strips an attachment action's `integration` block from API responses, so a test
   * cannot read the approval id off the prompt — it comes from the app's own store instead.
   */
  pendingApprovalId(): string {
    const database = new DatabaseSync(this.databasePath, { readOnly: true });
    try {
      const row = database
        .prepare(`SELECT id FROM Approval WHERE status = 'pending' ORDER BY createdAt DESC LIMIT 1`)
        .get() as undefined | { id: string };
      if (!row) {
        throw new Error('no approval is awaiting a decision');
      }
      return row.id;
    } finally {
      database.close();
    }
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  async start(): Promise<void> {
    try {
      await fs.promises.writeFile(this.configPath, JSON.stringify(this.config), { mode: 0o600 });
      await this.migrate();
      this.seedCredentials();
      this.child = spawn(process.execPath, ['src/main.ts'], {
        cwd: PROJECT_ROOT,
        env: {
          ...process.env,
          APP_HOST: COLLEGIUM_FIXTURE.bindHost,
          APP_PORT: String(this.port),
          APP_PUBLIC_URL: this.publicUrl,
          CONFIG_PATH: this.configPath,
          DATABASE_URL: this.databaseUrl,
          MATTERMOST_TEAM: this.mattermost.teamName,
          MATTERMOST_URL: this.mattermost.url,
          WORKSPACE_ROOT: this.workspaceRoot
        },
        stdio: ['pipe', 'pipe', 'pipe']
      });
      this.child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
        this.stdout += chunk;
      });
      this.child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
        this.stderr += chunk;
      });
      await this.waitUntilHealthy();
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  async stop(): Promise<void> {
    const child = this.child;
    this.child = undefined;
    if (!child || hasExited(child)) {
      return;
    }
    child.kill('SIGTERM');
    await withTimeout(waitUntilExited(child), COLLEGIUM_TIMEOUTS.shutdown, () => undefined);
    if (!hasExited(child)) {
      child.kill('SIGKILL');
      await waitUntilExited(child);
    }
  }

  /** where a test can assert file contents after approving and their absence after denying */
  workspaceDirFor(agentUsername: string): string {
    return path.join(this.workspaceRoot, agentUsername);
  }

  /** the app boots against this file, so its schema must exist before the process does */
  private async migrate(): Promise<void> {
    await exec('npx', ['prisma', 'migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: this.databaseUrl }
    });
  }

  /**
   * The rows provisioning would have written. This suite provisions its own workspace instead — one
   * uniquely named bot set per run, so runs do not collide — and hands the app what it minted.
   */
  private seedCredentials(): void {
    const database = new DatabaseSync(this.databasePath);
    try {
      const insert = database.prepare(
        'INSERT OR REPLACE INTO MattermostCredential (username, token, userId) VALUES (?, ?, ?)'
      );
      for (const bot of this.credentials) {
        insert.run(bot.username, bot.token, bot.userId);
      }
    } finally {
      database.close();
    }
  }

  private async waitUntilHealthy(): Promise<void> {
    await waitFor({
      describeFailure: () => this.logs(),
      description: `Collegium to report healthy at ${this.url}/health`,
      probe: async () => {
        const child = this.child;
        if (child && hasExited(child)) {
          throw new ProbeAbortError(`Collegium exited before becoming healthy\n${this.logs()}`);
        }
        const body = await fetch(`${this.url}/health`)
          .then((response) => (response.ok ? (response.json() as Promise<{ status?: string }>) : undefined))
          .catch(() => undefined);
        return body?.status === 'ok' ? true : PENDING;
      },
      timeoutMs: COLLEGIUM_TIMEOUTS.startup
    });
  }
}

export { awaitAgentHandshake, buildCollegiumConfig, CollegiumProcess };
