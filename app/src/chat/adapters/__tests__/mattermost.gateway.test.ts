import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { $AgentDefinition } from '@/config/config.schemas.ts';
import { ConfigService } from '@/config/config.service.ts';
import { EnvService } from '@/config/env/env.service.ts';
import { LoggerFactory } from '@/logging/logging.factory.ts';
import { createConfigServiceMock } from '@/testing/factories/config-service.factory.ts';
import { createEnvServiceMock } from '@/testing/factories/env-service.factory.ts';

import { MattermostChannelType } from '../mattermost.constants.ts';
import { MattermostGateway } from '../mattermost.gateway.ts';
import { MattermostTransport } from '../mattermost.transport.ts';

import type { SlashCommandRegistration } from '../../chat.types.ts';

const vendor = vi.hoisted(() => {
  /** the missing-member error Mattermost answers a membership probe with, the one shape the seam decodes */
  class ClientError extends Error {
    server_error_id: string;
    constructor(serverErrorId: string) {
      super(serverErrorId);
      this.server_error_id = serverErrorId;
    }
  }

  const mattermost = {
    channelMemberIds: new Set<string>(),
    profilesByToken: new Map<string, { id: string; username: string }>()
  };

  class Client4 {
    addCommand = vi.fn();
    createPost = vi.fn();
    deleteCommand = vi.fn();
    editCommand = vi.fn();
    getChannel = vi.fn();
    // the fixture's channel ids are their handles, so what a caller asked for stays legible downstream
    getChannelByName = vi.fn((teamId: string, handle: string) =>
      Promise.resolve({ id: handle, team_id: teamId, type: 'O' })
    );
    getChannelMember = vi.fn((channelId: string, userId: string) => {
      if (!mattermost.channelMemberIds.has(userId)) {
        return Promise.reject(new ClientError('app.channel.get_member.missing.app_error'));
      }
      return Promise.resolve({ channel_id: channelId, user_id: userId });
    });
    getClientConfig = vi.fn();
    getCustomTeamCommands = vi.fn();
    token = '';
    getMe = vi.fn(() => Promise.resolve(mattermost.profilesByToken.get(this.token)));
    getProfilesByIds = vi.fn();
    getTeamByName = vi.fn(() => Promise.resolve({ id: 'team-1' }));
    uploadFile = vi.fn();
    url = '';
    constructor() {
      clients.push(this);
    }
    setToken(token: string) {
      this.token = token;
    }
    setUrl(url: string) {
      this.url = url;
    }
  }

  class WebSocketClient {
    addCloseListener = vi.fn();
    addErrorListener = vi.fn();
    readonly messageListeners: ((event: unknown) => void)[] = [];
    addMessageListener = vi.fn((listener: (event: unknown) => void) => {
      this.messageListeners.push(listener);
    });
    addMissedMessageListener = vi.fn();
    close = vi.fn();
    initialize = vi.fn();
    constructor() {
      sockets.push(this);
    }
  }

  const clients: Client4[] = [];
  const sockets: WebSocketClient[] = [];
  return { Client4, ClientError, clients, mattermost, sockets, WebSocketClient };
});

vi.mock('@mattermost/client', () => ({
  Client4: vendor.Client4,
  ClientError: vendor.ClientError,
  WebSocketClient: vendor.WebSocketClient
}));

const definition = (username: string, botToken: string): $AgentDefinition => ({
  botToken,
  expertise: 'code review',
  model: { name: 'deepseek-v4-flash', provider: 'deepseek' },
  skills: [],
  systemPrompt: `You are ${username}`,
  tools: [],
  username
});

const REGISTRATION: SlashCommandRegistration = {
  autoCompleteHint: '[agent]',
  description: 'Stop the current turn',
  displayName: 'Stop',
  trigger: 'stop',
  url: 'http://localhost:3000/commands'
};

const wireCommand = (overrides: { creator_id: string; id: string; trigger: string }) => ({
  auto_complete: true,
  auto_complete_hint: '[agent]',
  description: 'Stop the current turn',
  display_name: 'Stop',
  method: 'P',
  url: 'http://localhost:3000/commands',
  ...overrides
});

const postedEvent = (senderName: string) => ({
  data: {
    channel_type: MattermostChannelType.Open,
    post: JSON.stringify({
      channel_id: 'main-channel',
      create_at: 1700000000000,
      id: 'post-1',
      message: 'hello',
      type: ''
    }),
    sender_name: senderName
  },
  event: 'posted'
});

describe('MattermostGateway', () => {
  let mattermostGateway: MattermostGateway;

  const agentClient = () => vendor.clients[1]!;
  const systemClient = () => vendor.clients[0]!;

  beforeEach(async () => {
    vendor.clients.length = 0;
    vendor.sockets.length = 0;
    vendor.mattermost.channelMemberIds = new Set(['mira-user-id', 'tess-user-id']);
    vendor.mattermost.profilesByToken = new Map([
      ['mira-token', { id: 'mira-user-id', username: 'mira' }],
      ['system-token', { id: 'system-user-id', username: 'Collegium' }],
      ['tess-token', { id: 'tess-user-id', username: 'tess' }]
    ]);
    const configService = createConfigServiceMock({
      agents: [definition('mira', 'mira-token'), definition('tess', 'tess-token')],
      app: { logLevel: 'error' },
      mattermost: { mainChannel: 'main-channel', systemBotToken: 'system-token' }
    });
    const moduleRef = await Test.createTestingModule({
      providers: [
        LoggerFactory,
        MattermostGateway,
        { provide: ConfigService, useValue: configService },
        { provide: EnvService, useValue: createEnvServiceMock({ MATTERMOST_URL: 'http://localhost:8065/' }) }
      ]
    }).compile();
    mattermostGateway = moduleRef.get(MattermostGateway);
  });

  const settle = () => new Promise((resolve) => setImmediate(resolve));

  it('should point the system client at the configured url without its trailing slash', () => {
    expect(systemClient()).toMatchObject({ token: 'system-token', url: 'http://localhost:8065' });
  });

  describe('connect', () => {
    it("should hand back a transport driven by the agent's own bot token", async () => {
      const transport = await mattermostGateway.connect({ agent: { username: 'mira' }, botToken: 'mira-token' });
      expect(transport).toBeInstanceOf(MattermostTransport);
      expect(agentClient()).toMatchObject({ token: 'mira-token', url: 'http://localhost:8065' });
    });

    it('should classify posts by the agent roster and the resolved system bot identity', async () => {
      const transport = await mattermostGateway.connect({ agent: { username: 'mira' }, botToken: 'mira-token' });
      const authorKinds: string[] = [];
      transport.listen((event) => {
        if (event.kind === 'posted') {
          authorKinds.push(event.post.authorKind);
        }
      });
      ['@tess', '@Collegium', '@casey'].forEach((senderName) => {
        vendor.sockets[0]!.messageListeners.forEach((listener) => listener(postedEvent(senderName)));
      });
      await settle();
      expect(authorKinds).toStrictEqual(['agent', 'system', 'human']);
    });

    it("should refuse an agent holding another user's bot token", async () => {
      const connecting = mattermostGateway.connect({ agent: { username: 'mira' }, botToken: 'tess-token' });
      await expect(connecting).rejects.toThrow('agent "mira" has the bot token of Mattermost user "@tess"');
    });

    it('should refuse an agent that is not a member of the main channel', async () => {
      vendor.mattermost.channelMemberIds.delete('mira-user-id');
      const connecting = mattermostGateway.connect({ agent: { username: 'mira' }, botToken: 'mira-token' });
      await expect(connecting).rejects.toThrow('agent "mira" is not a member of the main channel "main-channel"');
    });
  });

  describe('channel resolution', () => {
    it('should resolve a handle to its id within the configured team', async () => {
      await expect(mattermostGateway.resolveChannelId('work')).resolves.toBe('work');
      expect(systemClient().getChannelByName).toHaveBeenCalledWith('team-1', 'work');
    });

    it('should resolve each handle once and share the answer', async () => {
      await mattermostGateway.resolveChannelId('work');
      await mattermostGateway.resolveChannelId('work');
      expect(systemClient().getChannelByName).toHaveBeenCalledOnce();
    });

    it('should refuse a handle the team does not hold', async () => {
      systemClient().getChannelByName.mockRejectedValue(new Error('404'));
      await expect(mattermostGateway.resolveChannelId('ghost')).rejects.toThrow(
        'no channel "ghost" in team "collegium"'
      );
    });

    it('should refuse a team the server does not hold', async () => {
      systemClient().getTeamByName.mockRejectedValue(new Error('404'));
      await expect(mattermostGateway.resolveChannelId('work')).rejects.toThrow('no team "collegium"');
    });
  });

  describe('slash commands', () => {
    it('should create a missing command on the configured team', async () => {
      await mattermostGateway.createSlashCommand(REGISTRATION);
      expect(systemClient().addCommand).toHaveBeenCalledWith(
        expect.objectContaining({ team_id: 'team-1', trigger: 'stop', url: REGISTRATION.url })
      );
    });

    it('should correct a drifted command in place', async () => {
      await mattermostGateway.correctSlashCommand('command-1', REGISTRATION);
      expect(systemClient().editCommand).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'command-1', team_id: 'team-1', trigger: 'stop' })
      );
    });

    it('should delete a command by id', async () => {
      await mattermostGateway.deleteSlashCommand('command-1');
      expect(systemClient().deleteCommand).toHaveBeenCalledWith('command-1');
    });

    it('should resolve the team once and share it across registrations', async () => {
      await mattermostGateway.createSlashCommand(REGISTRATION);
      await mattermostGateway.correctSlashCommand('command-1', REGISTRATION);
      expect(systemClient().getTeamByName).toHaveBeenCalledOnce();
    });

    it("should snapshot the team's commands with their creators resolved", async () => {
      systemClient().getCustomTeamCommands.mockResolvedValue([
        wireCommand({ creator_id: 'system-user-id', id: 'command-1', trigger: 'stop' }),
        wireCommand({ creator_id: 'ghost-user-id', id: 'command-2', trigger: 'kill' })
      ]);
      systemClient().getProfilesByIds.mockResolvedValue([{ id: 'system-user-id', username: 'collegium' }]);
      const surface = await mattermostGateway.snapshotSlashCommandSurface();
      expect(surface.ownUserId).toBe('system-user-id');
      expect(surface.commands.map((command) => command.creatorUsername)).toStrictEqual(['collegium', 'ghost-user-id']);
    });
  });

  describe('system posts', () => {
    beforeEach(() => {
      systemClient().createPost.mockResolvedValue({ create_at: 1700000000000, id: 'post-1' });
    });

    it('should post a notice to the main channel as the system bot', async () => {
      const receipt = await mattermostGateway.postAsSystem('halted');
      expect(systemClient().createPost).toHaveBeenCalledWith({ channel_id: 'main-channel', message: 'halted' });
      expect(receipt.value).toStrictEqual({
        authorUsername: 'collegium',
        createdAt: new Date(1700000000000),
        postId: 'post-1'
      });
    });

    // the crash handler reports through this path, so a throw here would replace the failure it carries
    it('should answer a failure rather than throw when the main channel cannot be resolved', async () => {
      systemClient().getChannelByName.mockRejectedValue(new Error('404'));
      await expect(mattermostGateway.postAsSystem('halted')).resolves.toMatchObject({ success: false });
    });

    it('should post a notice to a named channel', async () => {
      await mattermostGateway.postAsSystemIn('other-channel', 'a trigger fired');
      expect(systemClient().createPost).toHaveBeenCalledWith({
        channel_id: 'other-channel',
        message: 'a trigger fired'
      });
    });

    it('should upload files into the channel and attach them to the post', async () => {
      systemClient().uploadFile.mockResolvedValue({ file_infos: [{ id: 'file-1' }] });
      const receipt = await mattermostGateway.postAsSystemIn('other-channel', 'body attached', [
        { content: 'the whole body', filename: 'mail.md' }
      ]);
      expect(receipt.success).toBe(true);
      const formData = systemClient().uploadFile.mock.calls[0]?.[0] as FormData;
      expect(formData.get('channel_id')).toBe('other-channel');
      expect(systemClient().createPost).toHaveBeenCalledWith({
        channel_id: 'other-channel',
        file_ids: ['file-1'],
        message: 'body attached'
      });
    });

    it("should answer the server's own post-size limit", async () => {
      systemClient().getClientConfig.mockResolvedValue({ MaxPostSize: '16383' });
      expect((await mattermostGateway.maxPostSizeChars()).value).toBe(16_383);
    });
  });
});
