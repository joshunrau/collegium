import { ClientError } from '@mattermost/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MattermostClient } from '../mattermost.client.ts';

import type { SlashCommandRegistration } from '../../chat.types.ts';

const sdk = vi.hoisted(() => ({
  addCommand: vi.fn(),
  addReaction: vi.fn(),
  createPost: vi.fn(),
  deleteCommand: vi.fn(),
  editCommand: vi.fn(),
  getBaseRoute: vi.fn(() => 'https://mattermost.test/api/v4'),
  getChannel: vi.fn(),
  getChannelByName: vi.fn(),
  getChannelMember: vi.fn(),
  getClientConfig: vi.fn(),
  getCustomTeamCommands: vi.fn(),
  getMe: vi.fn(),
  getMyChannels: vi.fn(),
  getMyTeams: vi.fn(),
  getPosts: vi.fn(),
  getPostsAfter: vi.fn(),
  getProfilesByIds: vi.fn(),
  getTeamByName: vi.fn(),
  getToken: vi.fn(() => 'bot-token'),
  getUser: vi.fn(),
  patchPost: vi.fn(),
  setToken: vi.fn(),
  setUrl: vi.fn()
}));

vi.mock('@mattermost/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mattermost/client')>();
  const Client4 = class {
    constructor() {
      return sdk;
    }
  };
  return { ...actual, Client4: Client4 as unknown as typeof actual.Client4 };
});

const REGISTRATION: SlashCommandRegistration = {
  autoCompleteHint: '[agent]',
  description: 'stop the turn',
  displayName: 'Stop',
  trigger: 'stop',
  url: 'https://app.test/commands'
};

const restPost = (id: string) => ({
  channel_id: 'channel-1',
  create_at: 1700000000000,
  id,
  message: `message ${id}`,
  type: '',
  user_id: 'user-1'
});

const memberError = (serverErrorId: string) =>
  new ClientError('https://mattermost.test', { message: 'refused', server_error_id: serverErrorId });

describe('MattermostClient', () => {
  const fetchMock = vi.fn();
  let client: MattermostClient;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    client = new MattermostClient({ token: 'bot-token', url: 'https://mattermost.test' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should point the vendor client at the configured url and token', () => {
    expect(sdk.setUrl).toHaveBeenCalledWith('https://mattermost.test');
    expect(sdk.setToken).toHaveBeenCalledWith('bot-token');
  });

  it('should reorder a reaction into the vendor positional signature', async () => {
    await client.addReaction({ emojiName: 'eyes', postId: 'post-1', userId: 'user-1' });
    expect(sdk.addReaction).toHaveBeenCalledWith('user-1', 'post-1', 'eyes');
  });

  it('should create a post and return only its id and creation time', async () => {
    sdk.createPost.mockResolvedValue({ channel_id: 'channel-1', create_at: 1700000000000, id: 'post-1' });
    const created = await client.createPost({ channelId: 'channel-1', message: 'hello' });
    expect(sdk.createPost).toHaveBeenCalledWith({ channel_id: 'channel-1', message: 'hello' });
    expect(created).toStrictEqual({ createAt: 1700000000000, id: 'post-1' });
  });

  it('should nest attachments under the vendor props key', async () => {
    sdk.createPost.mockResolvedValue({ create_at: 1700000000000, id: 'post-1' });
    const attachments = [{ text: 'approve?' }];
    await client.createPost({ attachments, channelId: 'channel-1', message: 'hello' });
    expect(sdk.createPost).toHaveBeenCalledWith({
      channel_id: 'channel-1',
      message: 'hello',
      props: { attachments }
    });
  });

  it('should register a slash command with the server-owned fields left blank', async () => {
    await client.createSlashCommand({ ...REGISTRATION, teamId: 'team-1' });
    expect(sdk.addCommand).toHaveBeenCalledWith({
      auto_complete: true,
      auto_complete_desc: 'stop the turn',
      auto_complete_hint: '[agent]',
      create_at: 0,
      creator_id: '',
      delete_at: 0,
      description: 'stop the turn',
      display_name: 'Stop',
      icon_url: '',
      id: '',
      method: 'P',
      team_id: 'team-1',
      token: '',
      trigger: 'stop',
      update_at: 0,
      url: 'https://app.test/commands',
      username: ''
    });
  });

  it('should edit a slash command under its existing id', async () => {
    await client.updateSlashCommand({ ...REGISTRATION, commandId: 'command-1', teamId: 'team-1' });
    expect(sdk.editCommand).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'command-1', team_id: 'team-1', trigger: 'stop' })
    );
  });

  it('should delete a slash command by id', async () => {
    await client.deleteSlashCommand('command-1');
    expect(sdk.deleteCommand).toHaveBeenCalledWith('command-1');
  });

  it('should project a fetched channel onto its type', async () => {
    sdk.getChannel.mockResolvedValue({ id: 'channel-1', team_id: 'team-1', type: 'O' });
    await expect(client.getChannelType('channel-1')).resolves.toBe('O');
  });

  it('should resolve a channel handle to its id within the team', async () => {
    sdk.getChannelByName.mockResolvedValue({ id: 'channel-1', team_id: 'team-1', type: 'O' });
    await expect(client.getChannelIdByName({ handle: 'town-square', teamId: 'team-1' })).resolves.toBe('channel-1');
    expect(sdk.getChannelByName).toHaveBeenCalledWith('team-1', 'town-square');
  });

  it('should resolve a team handle to its id', async () => {
    sdk.getTeamByName.mockResolvedValue({ id: 'team-1' });
    await expect(client.getTeamIdByName('collegium')).resolves.toBe('team-1');
  });

  it('should return the latest posts in the order the page names, dropping ids it lacks', async () => {
    sdk.getPosts.mockResolvedValue({
      order: ['post-2', 'post-gone', 'post-1'],
      posts: { 'post-1': restPost('post-1'), 'post-2': restPost('post-2') }
    });
    const posts = await client.getLatestPosts({ channelId: 'channel-1', perPage: 50 });
    expect(sdk.getPosts).toHaveBeenCalledWith('channel-1', 0, 50);
    expect(posts.map((post) => post.id)).toStrictEqual(['post-2', 'post-1']);
  });

  it('should page posts after a named post', async () => {
    sdk.getPostsAfter.mockResolvedValue({ order: ['post-2'], posts: { 'post-2': restPost('post-2') } });
    const posts = await client.getPostsAfter({
      afterPostId: 'post-1',
      channelId: 'channel-1',
      page: 2,
      perPage: 50
    });
    expect(sdk.getPostsAfter).toHaveBeenCalledWith('channel-1', 'post-1', 2, 50);
    expect(posts.map((post) => post.id)).toStrictEqual(['post-2']);
  });

  it('should collect channel ids across every team without repeating one', async () => {
    sdk.getMyTeams.mockResolvedValue([{ id: 'team-1' }, { id: 'team-2' }]);
    sdk.getMyChannels
      .mockResolvedValueOnce([
        { id: 'channel-1', type: 'O' },
        { id: 'channel-2', type: 'P' }
      ])
      .mockResolvedValueOnce([{ id: 'channel-2', type: 'P' }]);
    await expect(client.getOwnChannelIds()).resolves.toStrictEqual(['channel-1', 'channel-2']);
  });

  it('should return its own profile', async () => {
    sdk.getMe.mockResolvedValue({ id: 'user-1', username: 'mira' });
    await expect(client.getOwnProfile()).resolves.toMatchObject({ id: 'user-1', username: 'mira' });
  });

  it('should camel-case the commands a team already holds', async () => {
    sdk.getCustomTeamCommands.mockResolvedValue([
      {
        auto_complete: true,
        auto_complete_hint: '[agent]',
        creator_id: 'user-1',
        description: 'stop the turn',
        display_name: 'Stop',
        id: 'command-1',
        method: 'P',
        trigger: 'stop',
        url: 'https://app.test/commands'
      }
    ]);
    await expect(client.getTeamSlashCommands('team-1')).resolves.toStrictEqual([
      {
        autoComplete: true,
        autoCompleteHint: '[agent]',
        creatorId: 'user-1',
        description: 'stop the turn',
        displayName: 'Stop',
        id: 'command-1',
        method: 'P',
        trigger: 'stop',
        url: 'https://app.test/commands'
      }
    ]);
  });

  it('should reduce a user profile to its bot flag and username', async () => {
    sdk.getUser.mockResolvedValue({ id: 'user-1', is_bot: true, username: 'collegium' });
    await expect(client.getUser('user-1')).resolves.toStrictEqual({ isBot: true, username: 'collegium' });
  });

  it('should not ask the vendor for an empty set of usernames', async () => {
    await expect(client.getUsernamesByIds([])).resolves.toStrictEqual(new Map());
    expect(sdk.getProfilesByIds).not.toHaveBeenCalled();
  });

  it('should map every requested id to its username', async () => {
    sdk.getProfilesByIds.mockResolvedValue([
      { id: 'user-1', username: 'mira' },
      { id: 'user-2', username: 'tess' }
    ]);
    await expect(client.getUsernamesByIds(['user-1', 'user-2'])).resolves.toStrictEqual(
      new Map([
        ['user-1', 'mira'],
        ['user-2', 'tess']
      ])
    );
    expect(sdk.getProfilesByIds).toHaveBeenCalledWith(['user-1', 'user-2']);
  });

  it('should report membership when the vendor resolves the member', async () => {
    sdk.getChannelMember.mockResolvedValue({});
    await expect(client.isChannelMember({ channelId: 'channel-1', userId: 'user-1' })).resolves.toBe(true);
    expect(sdk.getChannelMember).toHaveBeenCalledWith('channel-1', 'user-1');
  });

  it('should read the missing-member error as a non-member rather than a failure', async () => {
    sdk.getChannelMember.mockRejectedValue(memberError('app.channel.get_member.missing.app_error'));
    await expect(client.isChannelMember({ channelId: 'channel-1', userId: 'user-1' })).resolves.toBe(false);
  });

  it('should rethrow any failure other than the missing member', async () => {
    sdk.getChannelMember.mockRejectedValueOnce(memberError('api.context.permissions.app_error'));
    await expect(client.isChannelMember({ channelId: 'channel-1', userId: 'user-1' })).rejects.toThrow('refused');
    sdk.getChannelMember.mockRejectedValueOnce(new Error('the socket died'));
    await expect(client.isChannelMember({ channelId: 'channel-1', userId: 'user-1' })).rejects.toThrow(
      'the socket died'
    );
  });

  it('should translate a dialog request into the integration wire shape', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    await client.openDialog({
      callbackId: 'approval-1',
      elements: [{ displayName: 'Reason', name: 'reason', optional: true, type: 'textarea' }],
      state: 'turn-1',
      submitLabel: 'Deny',
      title: 'Deny the action',
      triggerId: 'trigger-1',
      url: 'https://app.test/decisions'
    });
    expect(fetchMock).toHaveBeenCalledWith('https://mattermost.test/api/v4/actions/dialogs/open', {
      body: JSON.stringify({
        dialog: {
          callback_id: 'approval-1',
          elements: [{ display_name: 'Reason', name: 'reason', optional: true, type: 'textarea' }],
          state: 'turn-1',
          submit_label: 'Deny',
          title: 'Deny the action'
        },
        trigger_id: 'trigger-1',
        url: 'https://app.test/decisions'
      }),
      headers: { authorization: 'Bearer bot-token', 'content-type': 'application/json' },
      method: 'POST'
    });
  });

  it('should default an element to required and omit the optional dialog fields', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    await client.openDialog({
      callbackId: 'approval-1',
      elements: [{ displayName: 'Reason', name: 'reason', type: 'textarea' }],
      title: 'Deny the action',
      triggerId: 'trigger-1',
      url: 'https://app.test/decisions'
    });
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      body: JSON.stringify({
        dialog: {
          callback_id: 'approval-1',
          elements: [{ display_name: 'Reason', name: 'reason', optional: false, type: 'textarea' }],
          title: 'Deny the action'
        },
        trigger_id: 'trigger-1',
        url: 'https://app.test/decisions'
      })
    });
  });

  it('should refuse loudly when the dialog request is rejected', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403 });
    await expect(
      client.openDialog({
        callbackId: 'approval-1',
        elements: [],
        title: 'Deny the action',
        triggerId: 'trigger-1',
        url: 'https://app.test/decisions'
      })
    ).rejects.toThrow('the dialog open request was refused with status 403');
  });

  it('should patch a post, carrying props only when attachments are given', async () => {
    await client.updatePost({ attachments: [], message: 'resolved', postId: 'post-1' });
    expect(sdk.patchPost).toHaveBeenCalledWith({ id: 'post-1', message: 'resolved', props: { attachments: [] } });
    await client.updatePost({ message: 'resolved', postId: 'post-1' });
    expect(sdk.patchPost).toHaveBeenLastCalledWith({ id: 'post-1', message: 'resolved' });
  });

  it('should read MaxPostSize from the client config, coercing the string the server sends', async () => {
    sdk.getClientConfig.mockResolvedValue({ MaxPostSize: '4000' });
    expect(await client.getMaxPostSize()).toBe(4000);
  });
});
