import { COMMAND_SURFACE_ROUTE, MATTERMOST_PLUGIN_ID } from '@collegium/mattermost';
import { Client4, ClientError } from '@mattermost/client';

import {
  $MattermostChannel,
  $MattermostClientConfig,
  $MattermostCreatedPost,
  $MattermostFileUpload,
  $MattermostPostList,
  $MattermostSlashCommand,
  $MattermostTeam,
  $MattermostUserProfile
} from './mattermost.schemas.ts';

import type { CommandSurfaceDeclaration, DialogRequest, MessageAttachment } from '../chat.types.ts';
import type { MattermostChannelType } from './mattermost.constants.ts';
import type { $MattermostRestPost } from './mattermost.schemas.ts';

/** the wire is the vendor's, so keys cross this file as snake_case and nothing outside it sees them */
export class MattermostClient {
  private readonly sdk: Client4;

  constructor(options: { token: string; url: string }) {
    this.sdk = new Client4();
    this.sdk.setUrl(options.url);
    this.sdk.setToken(options.token);
  }

  async addReaction(params: { emojiName: string; postId: string; userId: string }): Promise<void> {
    await this.sdk.addReaction(params.userId, params.postId, params.emojiName);
  }

  async createPost(params: {
    attachments?: readonly MessageAttachment[];
    channelId: string;
    fileIds?: readonly string[];
    message: string;
  }): Promise<{ createAt: number; id: string }> {
    const created = await this.sdk.createPost({
      channel_id: params.channelId,
      message: params.message,
      ...(params.attachments && { props: { attachments: params.attachments } }),
      ...(params.fileIds && { file_ids: [...params.fileIds] })
    });
    return $MattermostCreatedPost.parse(created);
  }

  /**
   * §8.4 — the plugin's own route, which Client4 has no wrapper for. The refusals a boot can meet
   * are named here, because "404" says nothing about a plugin that was never installed.
   */
  async declarePluginCommandSurface(params: CommandSurfaceDeclaration & { teamId: string }): Promise<void> {
    const route = COMMAND_SURFACE_ROUTE.replace('{teamId}', params.teamId);
    const response = await fetch(`${this.sdk.getUrl()}/plugins/${MATTERMOST_PLUGIN_ID}${route}`, {
      body: JSON.stringify({ callbackUrl: params.callbackUrl, commands: params.commands }),
      headers: { authorization: `Bearer ${this.sdk.getToken()}`, 'content-type': 'application/json' },
      method: 'PUT'
    });
    if (response.ok) {
      return;
    }
    if (response.status === 404) {
      throw new Error(
        `the Collegium plugin (${MATTERMOST_PLUGIN_ID}) is not installed or not enabled on this Mattermost, so /collegium cannot be registered — provisioning installs it when plugin uploads are allowed`
      );
    }
    if (response.status === 403) {
      throw new Error(
        'the system bot lacks manage_own_slash_commands on the team, which declaring /collegium requires'
      );
    }
    throw new Error(
      `the Collegium plugin refused the command surface with status ${response.status}: ${await response.text()}`
    );
  }

  async deleteSlashCommand(commandId: string): Promise<void> {
    await this.sdk.deleteCommand(commandId);
  }

  /** the id of a channel named by its handle, scoped to the team it lives in */
  async getChannelIdByName(params: { handle: string; teamId: string }): Promise<string> {
    return $MattermostChannel.parse(await this.sdk.getChannelByName(params.teamId, params.handle)).id;
  }

  async getChannelType(channelId: string): Promise<MattermostChannelType> {
    return $MattermostChannel.parse(await this.sdk.getChannel(channelId)).type;
  }

  async getLatestPosts(params: { channelId: string; perPage: number }): Promise<$MattermostRestPost[]> {
    return this.toOrderedPosts(await this.sdk.getPosts(params.channelId, 0, params.perPage));
  }

  async getMaxPostSize(): Promise<number> {
    return $MattermostClientConfig.parse(await this.sdk.getClientConfig()).MaxPostSize;
  }

  async getOwnChannelIds(): Promise<string[]> {
    const teams = $MattermostTeam.array().parse(await this.sdk.getMyTeams());
    const channelIds = new Set<string>();
    for (const team of teams) {
      const channels = $MattermostChannel.array().parse(await this.sdk.getMyChannels(team.id));
      channels.forEach((channel) => channelIds.add(channel.id));
    }
    return [...channelIds];
  }

  async getOwnProfile(): Promise<{ id: string; username: string }> {
    return $MattermostUserProfile.parse(await this.sdk.getMe());
  }

  async getPostsAfter(params: {
    afterPostId: string;
    channelId: string;
    page: number;
    perPage: number;
  }): Promise<$MattermostRestPost[]> {
    return this.toOrderedPosts(
      await this.sdk.getPostsAfter(params.channelId, params.afterPostId, params.page, params.perPage)
    );
  }

  async getTeamIdByName(name: string): Promise<string> {
    return $MattermostTeam.parse(await this.sdk.getTeamByName(name)).id;
  }

  async getTeamSlashCommands(teamId: string): Promise<$MattermostSlashCommand[]> {
    return $MattermostSlashCommand.array().parse(await this.sdk.getCustomTeamCommands(teamId));
  }

  async getUser(userId: string): Promise<{ isBot: boolean; username: string }> {
    const profile = $MattermostUserProfile.parse(await this.sdk.getUser(userId));
    return { isBot: profile.is_bot, username: profile.username };
  }

  async getUsernamesByIds(userIds: readonly string[]): Promise<ReadonlyMap<string, string>> {
    if (userIds.length === 0) {
      return new Map();
    }
    const profiles = $MattermostUserProfile.array().parse(await this.sdk.getProfilesByIds([...userIds]));
    return new Map(profiles.map((profile) => [profile.id, profile.username]));
  }

  async isChannelMember(params: { channelId: string; userId: string }) {
    try {
      await this.sdk.getChannelMember(params.channelId, params.userId);
    } catch (err) {
      if (err instanceof ClientError && err.server_error_id === 'app.channel.get_member.missing.app_error') {
        return false;
      }
      throw err;
    }
    return true;
  }

  /** Client4 has no wrapper for the integration-side dialog API, so this one call goes to the wire directly */
  async openDialog(request: DialogRequest): Promise<void> {
    const response = await fetch(`${this.sdk.getBaseRoute()}/actions/dialogs/open`, {
      body: JSON.stringify({
        dialog: {
          callback_id: request.callbackId,
          elements: request.elements.map((element) => ({
            display_name: element.displayName,
            name: element.name,
            optional: element.optional ?? false,
            type: element.type
          })),
          ...(request.state && { state: request.state }),
          ...(request.submitLabel && { submit_label: request.submitLabel }),
          title: request.title
        },
        trigger_id: request.triggerId,
        url: request.url
      }),
      headers: { authorization: `Bearer ${this.sdk.getToken()}`, 'content-type': 'application/json' },
      method: 'POST'
    });
    if (!response.ok) {
      throw new Error(`the dialog open request was refused with status ${response.status}`);
    }
  }

  async updatePost(params: {
    attachments?: readonly MessageAttachment[];
    message: string;
    postId: string;
  }): Promise<void> {
    await this.sdk.patchPost({
      id: params.postId,
      message: params.message,
      ...(params.attachments && { props: { attachments: params.attachments } })
    });
  }

  /** one text file into the channel's store; the returned id attaches it to a post */
  async uploadFile(params: { channelId: string; content: string; filename: string }): Promise<string> {
    const formData = new FormData();
    formData.append('channel_id', params.channelId);
    formData.append('files', new Blob([params.content], { type: 'text/plain' }), params.filename);
    const uploaded = $MattermostFileUpload.parse(await this.sdk.uploadFile(formData));
    const id = uploaded.fileInfos[0]?.id;
    if (id === undefined) {
      throw new Error('the file upload answered with no file info');
    }
    return id;
  }

  private toOrderedPosts(pageBody: unknown): $MattermostRestPost[] {
    const page = $MattermostPostList.parse(pageBody);
    return page.order.map((id) => page.posts[id]).filter((post) => post !== undefined);
  }
}
