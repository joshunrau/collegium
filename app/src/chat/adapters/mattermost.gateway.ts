import type { Result } from '@collegium/core/utils';
import { removeTrailingSlash } from '@collegium/core/utils';

import type { Config } from '@/config/config.schemas.ts';
import { ConfigService } from '@/config/config.service.ts';
import { EnvService } from '@/config/env/env.service.ts';
import { LoggerFactory } from '@/logging/logging.factory.ts';

import { ChatGateway } from '../chat.gateway.ts';
import { MattermostClient } from './mattermost.client.ts';
import { MattermostTransport } from './mattermost.transport.ts';
import { createAuthorClassifier, toChatResult } from './mattermost.utils.ts';

import type { ChatTransport } from '../chat.transport.ts';
import type {
  AgentConnection,
  ChatFailure,
  PostFile,
  SlashCommandRegistration,
  SlashCommandSurface,
  SystemPostReceipt
} from '../chat.types.ts';

export class MattermostGateway extends ChatGateway {
  private readonly agentUsernames: ReadonlySet<string>;
  private readonly channelIds = new Map<string, Promise<string>>();
  private readonly config: Pick<Config, 'mattermost'>;
  private readonly systemClient: MattermostClient;
  private teamId: Promise<string> | undefined;
  private readonly teamName: string;
  private readonly url: string;

  constructor(
    options: { systemBotToken: string },
    configService: ConfigService,
    envService: EnvService,
    private readonly loggerFactory: LoggerFactory
  ) {
    super();
    this.agentUsernames = new Set(configService.get('agents').map((definition) => definition.username));
    this.config = { mattermost: configService.get('mattermost') };
    this.teamName = envService.get('MATTERMOST_TEAM');
    this.url = removeTrailingSlash(envService.get('MATTERMOST_URL'));
    this.systemClient = new MattermostClient({ token: options.systemBotToken, url: this.url });
  }

  async connect({ agent, botToken }: AgentConnection): Promise<ChatTransport> {
    const client = new MattermostClient({ token: botToken, url: this.url });
    const profile = await this.assertConfigured(client, agent.username);
    return new MattermostTransport({
      agent,
      botToken,
      classifyAuthor: createAuthorClassifier({
        agentUsernames: this.agentUsernames,
        systemBotUsername: this.config.mattermost.systemBotUsername
      }),
      client,
      logger: this.loggerFactory.createLogger(`${MattermostTransport.name} [${agent.username}]`),
      url: this.url,
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

  async postAsSystem(content: string): Promise<Result<SystemPostReceipt, ChatFailure>> {
    // resolving inside the Result is the whole point: the crash handler posts its offline notice
    // through here, and a throw at that moment would replace the failure being reported
    const mainChannelId = await toChatResult(() => this.resolveChannelId(this.config.mattermost.mainChannel));
    if (!mainChannelId.success) {
      return mainChannelId;
    }
    return this.postAsSystemIn(mainChannelId.value, content);
  }

  postAsSystemIn(
    channelId: string,
    content: string,
    files?: readonly PostFile[]
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
        authorUsername: this.config.mattermost.systemBotUsername,
        createdAt: new Date(created.createAt),
        postId: created.id
      };
    });
  }

  /**
   * A configured handle is the operator's declaration that the channel exists; one that resolves to
   * nothing is a refusal, never a channel silently skipped. Memoized per handle — channel ids are
   * fixed for the life of a channel, and every caller here asks at boot.
   */
  resolveChannelId(handle: string): Promise<string> {
    let channelId = this.channelIds.get(handle);
    if (!channelId) {
      channelId = this.resolveTeamId().then((teamId) =>
        this.systemClient.getChannelIdByName({ handle, teamId }).catch((error: unknown) => {
          throw new Error(`no channel "${handle}" in team "${this.teamName}"`, { cause: error });
        })
      );
      this.channelIds.set(handle, channelId);
    }
    return channelId;
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
    const mainChannel = this.config.mattermost.mainChannel;
    const isChannelMember = await client.isChannelMember({
      channelId: await this.resolveChannelId(mainChannel),
      userId: profile.id
    });
    if (!isChannelMember) {
      throw new Error(`agent "${username}" is not a member of the main channel "${mainChannel}"`);
    }
    return profile;
  }

  /** the team this deployment occupies: every channel handle resolves within it, and §8.4 commands belong to it */
  private resolveTeamId(): Promise<string> {
    this.teamId ??= this.systemClient.getTeamIdByName(this.teamName).catch((error: unknown) => {
      throw new Error(`no team "${this.teamName}" on this Mattermost server`, { cause: error });
    });
    return this.teamId;
  }
}
