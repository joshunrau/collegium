import { afterAll, afterEach, beforeAll, inject } from 'vitest';

import { Channel } from './channel.ts';
import { readMattermostLogs } from './cluster.ts';
import { awaitAgentHandshake, buildCollegiumConfig, CollegiumProcess } from './collegium.ts';
import { InferenceStub } from './inference.ts';
import { allocatePort } from './utils/port.utils.ts';
import { Workspace } from './workspace.ts';

import type { Scenario } from './scenario.ts';
import type { AgentBot, WorkspaceChannel, WorkspaceLimits } from './workspace.ts';

type AgentNameOf<S extends Scenario> = S['agents'][number]['username'];

type ChannelNameOf<S extends Scenario> = S['channels'][number]['name'];

type Harness<S extends Scenario> = {
  agents: { [K in AgentNameOf<S>]: AgentBot };
  app: CollegiumProcess;
  channels: { [K in ChannelNameOf<S>]: Channel<AgentNameOf<S>> };
  diagnostics: () => Promise<string>;
  inference: InferenceStub;
  /** §6.2 — the substrate's own limits, so no test hardcodes a number the server owns */
  limits: WorkspaceLimits;
  /** §3.2 — tests assert that mechanical output came from here and never from an agent */
  systemBot: AgentBot;
};

type StartedHarness<S extends Scenario> = {
  harness: Harness<S>;
  release: () => Promise<void>;
};

class ResourceStack {
  private readonly releases: (() => Promise<void>)[] = [];

  async release(): Promise<void> {
    // strictly last-in-first-out, one at a time: the app must die before the stub and workspace it uses
    const releases = this.releases.splice(0).reverse();
    const failures: unknown[] = [];
    for (const release of releases) {
      try {
        await release();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, 'failed to release one or more test resources');
    }
  }

  async use<T>(acquire: () => Promise<T>, release: (resource: T) => Promise<void>): Promise<T> {
    const resource = await acquire();
    this.releases.push(() => release(resource));
    return resource;
  }
}

function toRecord<K extends string, V>(entries: readonly (readonly [string, V])[]): { [P in K]: V } {
  return Object.fromEntries(entries) as { [P in K]: V };
}

async function startHarness<const S extends Scenario>(scenario: S): Promise<StartedHarness<S>> {
  const cluster = inject('cluster');
  const stack = new ResourceStack();
  try {
    // claimed before provisioning so APP_PUBLIC_URL names the port the app will bind
    const port = await allocatePort();
    const workspace = await stack.use(
      () => Workspace.provision({ connection: cluster, scenario }),
      (provisioned) => provisioned.dispose()
    );
    const agents = workspace.agents as ReadonlyMap<AgentNameOf<S>, AgentBot>;

    const inference = await stack.use(
      async () => {
        const stub = new InferenceStub(
          scenario.agents.map(({ systemPrompt, username }) => ({ systemPrompt, username }))
        );
        await stub.start();
        return stub;
      },
      (stub) => stub.stop()
    );

    const toChannel = (channel: WorkspaceChannel): Channel<AgentNameOf<S>> =>
      new Channel({
        agents,
        channel,
        client: workspace.client,
        socket: workspace.socket,
        systemBot: workspace.systemBot,
        teamId: workspace.teamId
      });

    const channels = scenario.channels.map(({ name }) => {
      const channel = workspace.channels.get(name);
      if (!channel) {
        throw new Error(`channel "${name}" was not provisioned`);
      }
      return [name, toChannel(channel)] as const;
    });

    const [mainChannel] = channels;
    if (!mainChannel) {
      throw new Error('a scenario must declare at least one channel');
    }

    const app = await stack.use(
      async () => {
        const collegium = new CollegiumProcess({
          config: buildCollegiumConfig({
            agents: workspace.agents,
            channels: workspace.channels,
            inference: { apiKey: inference.apiKey, baseUrl: inference.baseUrl },
            mainChannel: mainChannel[1].name,
            scenario,
            systemBotToken: workspace.systemBot.token
          }),
          mattermost: { teamName: cluster.teamName, url: cluster.url },
          port,
          publicHost: cluster.publicHost
        });
        await collegium.start();
        return collegium;
      },
      (collegium) => collegium.dispose()
    );

    const [firstAgent] = [...agents.keys()];
    if (firstAgent === undefined) {
      throw new Error('a scenario must declare at least one agent');
    }
    await awaitAgentHandshake({
      agent: firstAgent,
      channel: toChannel(workspace.handshakeChannel),
      inference
    });
    inference.forgetRequests();
    workspace.socket.forget();

    const harness: Harness<S> = {
      agents: toRecord<AgentNameOf<S>, AgentBot>([...agents]),
      app,
      channels: toRecord<ChannelNameOf<S>, Channel<AgentNameOf<S>>>(channels),
      diagnostics: async () =>
        [
          inference.diagnostics(),
          `channel "${mainChannel[1].name}":\n${await mainChannel[1].describeContents()}`,
          `collegium logs:\n${app.logs()}`,
          `mattermost logs:\n${await readMattermostLogs(cluster.containerId)}`
        ].join('\n\n'),
      inference,
      limits: workspace.limits,
      systemBot: workspace.systemBot
    };

    return { harness, release: () => stack.release() };
  } catch (error) {
    await stack.release();
    throw error;
  }
}

function setupHarness<const S extends Scenario>(scenario: S): () => Harness<S> {
  let started: StartedHarness<S> | undefined;

  beforeAll(async () => {
    started = await startHarness(scenario);
  });

  afterEach(async (context) => {
    if (context.task.result?.state === 'fail' && started) {
      process.stderr.write(`\n[e2e diagnostics] ${context.task.name}\n${await started.harness.diagnostics()}\n`);
    }
    const leftovers = started?.harness.inference.resetScripts() ?? [];
    if (leftovers.length > 0) {
      process.stderr.write(
        `\n[e2e hygiene] "${context.task.name}" left ${leftovers.length} unconsumed inference script(s):\n  ${leftovers.join('\n  ')}\n`
      );
    }
  });

  afterAll(async () => {
    const release = started?.release;
    started = undefined;
    await release?.();
  });

  return () => {
    if (!started) {
      throw new Error('the harness is only available once beforeAll has run');
    }
    return started.harness;
  };
}

export { setupHarness };
