import type { Result } from '@collegium/core/utils';
import { removeTrailingSlash } from '@collegium/core/utils';
import { Injectable } from '@nestjs/common';

import type { Config } from '@/config/config.schemas.ts';
import { ConfigService } from '@/config/config.service.ts';
import { LoggerFactory } from '@/logging/logging.factory.ts';

import { ChatGateway } from '../chat.gateway.ts';
import { MattermostClient } from './mattermost.client.ts';
import { MattermostTransport } from './mattermost.transport.ts';
import { classifyAuthor, toChatResult } from './mattermost.utils.ts';

import type { ChatTransport } from '../chat.transport.ts';
import type {
  AgentConnection,
  ChatFailure,
  SlashCommandRegistration,
  SlashCommandSurface,
  SystemPostFile,
  SystemPostReceipt
} from '../chat.types.ts';

@Injectable()
export class MattermostGateway extends ChatGateway {
  private readonly agentUsernames: ReadonlySet<string>;
  private readonly config: Pick<Config, 'mattermost'>;
  private systemBotUsername: Promise<string> | undefined;
  private readonly systemClient: MattermostClient;
  private teamId: Promise<string> | undefined;

  constructor(
    configService: ConfigService,
    private readonly loggerFactory: LoggerFactory
  ) {
    super();
    this.agentUsernames = new Set(configService.get('agents').map((definition) => definition.username));
    this.config = { mattermost: configService.get('mattermost') };
    this.systemClient = new MattermostClient({
      token: this.config.mattermost.systemBotToken,
      url: removeTrailingSlash(this.config.mattermost.url)
    });
  }

  async connect({ agent, botToken }: AgentConnection): Promise<ChatTransport> {
    const client = new MattermostClient({ token: botToken, url: removeTrailingSlash(this.config.mattermost.url) });
    const profile = await this.assertConfigured(client, agent.username);
    const systemBotUsername = await this.resolveSystemBotUsername();
    return new MattermostTransport({
      agent,
      botToken,
      classifyAuthor: (username) =>
        classifyAuthor(username, { agentUsernames: this.agentUsernames, systemBotUsername }),
      client,
      logger: this.loggerFactory.createLogger(`${MattermostTransport.name} [${agent.username}]`),
      url: removeTrailingSlash(this.config.mattermost.url),
      userId: profile.id
    });
  }

  async correctSlashCommand(commandId: string, registration: SlashCommandRegistration): Promise<void> {
    await this.systemClient.updateSlashCommand({ ...registration, commandId, teamId: await this.resolveTeamId() });
  }

  async createSlashCommand(registration: SlashCommandRegistration): Promise<void> {
    await this.systemClient.createSlashCommand({ ...registration, teamId: await this.resolveTeamId() });
  }

  async deleteSlashCommand(commandId: string): Promise<void> {
    await this.systemClient.deleteSlashCommand(commandId);
  }

  maxPostSizeChars(): Promise<Result<number, ChatFailure>> {
    return toChatResult(() => this.systemClient.getMaxPostSize());
  }

  postAsSystem(content: string): Promise<Result<SystemPostReceipt, ChatFailure>> {
    return this.postAsSystemIn(this.config.mattermost.mainChannelId, content);
  }

  postAsSystemIn(
    channelId: string,
    content: string,
    files?: readonly SystemPostFile[]
  ): Promise<Result<SystemPostReceipt, ChatFailure>> {
    return toChatResult(async () => {
      const fileIds = await Promise.all(
        (files ?? []).map((file) =>
          this.systemClient.uploadFile({ channelId, content: file.content, filename: file.filename })
        )
      );
      const created = await this.systemClient.createPost({
        channelId,
        ...(fileIds.length > 0 && { fileIds }),
        message: content
      });
      return {
        authorUsername: await this.resolveSystemBotUsername(),
        createdAt: new Date(created.createAt),
        postId: created.id
      };
    });
  }

  async snapshotSlashCommandSurface(): Promise<SlashCommandSurface> {
    const [teamId, ownProfile] = await Promise.all([this.resolveTeamId(), this.systemClient.getOwnProfile()]);
    const commands = await this.systemClient.getTeamSlashCommands(teamId);
    const creatorUsernames = await this.systemClient.getUsernamesByIds([
      ...new Set(commands.map((command) => command.creatorId))
    ]);
    return {
      commands: commands.map((command) => ({
        ...command,
        creatorUsername: creatorUsernames.get(command.creatorId) ?? command.creatorId
      })),
      ownUserId: ownProfile.id
    };
  }

  private async assertConfigured(
    client: MattermostClient,
    username: string
  ): Promise<{ id: string; username: string }> {
    // agents address each other by username, so one that is not the bot's handle is unreachable
    const profile = await client.getOwnProfile();
    if (profile.username !== username) {
      throw new Error(`agent "${username}" has the bot token of Mattermost user "@${profile.username}"`);
    }
    // a non-member hears nothing in the main channel, so a misconfigured bot would be silently deaf
    const isChannelMember = await client.isChannelMember({
      channelId: this.config.mattermost.mainChannelId,
      userId: profile.id
    });
    if (!isChannelMember) {
      throw new Error(
        `agent "${username}" is not a member of the main channel "${this.config.mattermost.mainChannelId}"`
      );
    }
    return profile;
  }

  /** resolved once and shared across connects — the system bot's username is not in config (§3.2) */
  private resolveSystemBotUsername(): Promise<string> {
    this.systemBotUsername ??= this.systemClient.getOwnProfile().then((profile) => profile.username.toLowerCase());
    return this.systemBotUsername;
  }

  /** slash commands are per team; the main channel's team is the one this deployment lives in (§8.4) */
  private resolveTeamId(): Promise<string> {
    this.teamId ??= this.systemClient.getChannelTeamId(this.config.mattermost.mainChannelId).then((teamId) => {
      if (teamId === '') {
        throw new Error(
          `the main channel "${this.config.mattermost.mainChannelId}" names no team, so slash commands cannot be reconciled`
        );
      }
      return teamId;
    });
    return this.teamId;
  }
}
