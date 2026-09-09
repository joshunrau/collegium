import { Client4 } from '@mattermost/client';
import { z } from 'zod';

import { MattermostChannelType } from '@/chat/adapters/mattermost.constants.ts';

import { WorkspaceSocket } from './socket.ts';
import { createWorkspaceId, toBotUsername, toChannelName, toTeamName } from './utils/naming.utils.ts';

import type { ClusterConnection } from './cluster.ts';
import type { Scenario } from './scenario.ts';

const HANDSHAKE_CHANNEL_NAME = 'handshake';

const SYSTEM_BOT_NAME = 'system';

const WORKSPACE_BOT_DESCRIPTION = 'Collegium end-to-end fixture';

type $CreatedTeam = z.infer<typeof $CreatedTeam>;
const $CreatedTeam = z.object({ id: z.string().min(1), name: z.string().min(1) });

type AgentBot = {
  token: string;
  userId: string;
  username: string;
};

type WorkspaceChannel = {
  id: string;
  name: string;
};

/** §6.2 — substrate limits are server settings, so the suite reads them rather than naming a number */
type WorkspaceLimits = {
  maxPostSize: number;
};

type WorkspaceOptions = {
  connection: ClusterConnection;
  scenario: Scenario;
};

class Workspace {
  private constructor(
    readonly adminUserId: string,
    readonly agents: ReadonlyMap<string, AgentBot>,
    readonly channels: ReadonlyMap<string, WorkspaceChannel>,
    readonly client: Client4,
    readonly handshakeChannel: WorkspaceChannel,
    readonly limits: WorkspaceLimits,
    readonly socket: WorkspaceSocket,
    readonly systemBot: AgentBot,
    readonly teamId: string,
    readonly teamName: string,
    readonly workspaceId: string
  ) {}

  static async provision({ connection, scenario }: WorkspaceOptions): Promise<Workspace> {
    const workspaceId = createWorkspaceId();
    const client = new Client4();
    client.setUrl(connection.url);
    const admin = await client.login(connection.admin.username, connection.admin.password);

    // its own team: the plugin holds one command surface per team (§8.4), so two apps alive at once
    // in a shared team would each overwrite the other's /collegium callback
    const team = await this.createTeam(client, toTeamName(workspaceId));
    const handshakeChannel = await this.createPublicChannel(client, team.id, workspaceId, HANDSHAKE_CHANNEL_NAME);

    const systemBot = await this.createBot(client, team.id, toBotUsername(workspaceId, SYSTEM_BOT_NAME));
    // the app declares its command surface to the plugin at boot (§8.4), which takes manage_own_slash_commands
    await client.updateTeamMemberSchemeRoles(team.id, systemBot.userId, true, true);
    const agents = new Map(
      await Promise.all(
        scenario.agents.map(async ({ username }) => {
          const bot = await this.createBot(client, team.id, toBotUsername(workspaceId, username));
          return [username, bot] as const;
        })
      )
    );
    const everyBot = [systemBot, ...agents.values()];
    await this.addMembers(client, handshakeChannel, everyBot);

    const channels = new Map(
      await Promise.all(
        scenario.channels.map(async (spec) => {
          const channel = await this.createChannel(client, team.id, workspaceId, spec, agents);
          // a direct channel's membership is fixed by the pair it was created for; Mattermost
          // rejects any attempt to add to it, the system bot included
          if (spec.type !== 'direct') {
            const members = spec.members?.map((name) => this.resolveBot(agents, name)) ?? [...agents.values()];
            await this.addMembers(client, channel, [systemBot, ...members]);
          }
          return [spec.name, channel] as const;
        })
      )
    );

    const limits = await this.readLimits(client);
    const socket = await WorkspaceSocket.connect({ token: client.getToken(), url: connection.url });

    return new this(
      admin.id,
      agents,
      channels,
      client,
      handshakeChannel,
      limits,
      socket,
      systemBot,
      team.id,
      team.name,
      workspaceId
    );
  }

  private static async addMembers(
    client: Client4,
    channel: WorkspaceChannel,
    bots: readonly AgentBot[]
  ): Promise<void> {
    for (const bot of bots) {
      await client.addToChannel(bot.userId, channel.id);
    }
  }

  private static async createBot(client: Client4, teamId: string, username: string): Promise<AgentBot> {
    const bot = await client.createBot({
      description: WORKSPACE_BOT_DESCRIPTION,
      display_name: username,
      username
    });
    await client.addToTeam(teamId, bot.user_id);
    const accessToken = await client.createUserAccessToken(bot.user_id, WORKSPACE_BOT_DESCRIPTION);
    if (!accessToken.token) {
      throw new Error(`Mattermost did not return an access token for bot "${username}"`);
    }
    return {
      token: accessToken.token,
      userId: bot.user_id,
      username
    };
  }

  private static async createChannel(
    client: Client4,
    teamId: string,
    workspaceId: string,
    spec: Scenario['channels'][number],
    agents: ReadonlyMap<string, AgentBot>
  ): Promise<WorkspaceChannel> {
    if (spec.type !== 'direct') {
      return this.createPublicChannel(client, teamId, workspaceId, spec.name);
    }
    const [member, ...rest] = spec.members ?? [];
    if (member === undefined || rest.length > 0) {
      throw new Error(
        `direct channel "${spec.name}" must declare exactly one member, received ${spec.members?.length ?? 0}`
      );
    }
    const me = await client.getMe();
    const channel = await client.createDirectChannel([me.id, this.resolveBot(agents, member).userId]);
    return { id: channel.id, name: spec.name };
  }

  private static async createPublicChannel(
    client: Client4,
    teamId: string,
    workspaceId: string,
    name: string
  ): Promise<WorkspaceChannel> {
    const channelName = toChannelName(workspaceId, name);
    const channel = await client.createChannel({
      display_name: channelName,
      name: channelName,
      team_id: teamId,
      type: MattermostChannelType.Open
    });
    return { id: channel.id, name: channelName };
  }

  /** the SDK's createTeam demands a whole Team where the server wants three fields, so this one goes over fetch */
  private static async createTeam(client: Client4, name: string): Promise<$CreatedTeam> {
    const response = await fetch(client.getTeamsRoute(), {
      body: JSON.stringify({ display_name: name, name, type: 'O' }),
      headers: { Authorization: `Bearer ${client.getToken()}`, 'Content-Type': 'application/json' },
      method: 'POST'
    });
    if (!response.ok) {
      throw new Error(`creating team "${name}" failed with ${response.status}: ${await response.text()}`);
    }
    return $CreatedTeam.parse(await response.json());
  }

  private static async readLimits(client: Client4): Promise<WorkspaceLimits> {
    const config = await client.getClientConfig();
    const maxPostSize = Number(config.MaxPostSize);
    if (!Number.isInteger(maxPostSize) || maxPostSize <= 0) {
      throw new Error(`Mattermost reported an unusable MaxPostSize of "${config.MaxPostSize}"`);
    }
    return { maxPostSize };
  }

  private static resolveBot(agents: ReadonlyMap<string, AgentBot>, username: string): AgentBot {
    const bot = agents.get(username);
    if (!bot) {
      throw new Error(`channel membership names agent "${username}", which the scenario does not declare`);
    }
    return bot;
  }

  dispose(): Promise<void> {
    this.socket.close();
    return Promise.resolve();
  }
}

export { Workspace };
export type { AgentBot, WorkspaceChannel, WorkspaceLimits };
