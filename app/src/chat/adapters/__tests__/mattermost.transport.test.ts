import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';

import { MattermostClient } from '../mattermost.client.ts';
import { MattermostChannelType } from '../mattermost.constants.ts';
import { MattermostTransport } from '../mattermost.transport.ts';

import type { ChatEvent } from '../../chat.types.ts';
import type { $MattermostRestPost } from '../mattermost.schemas.ts';
import type { MattermostTransportOptions } from '../mattermost.transport.ts';

const vendorSocket = vi.hoisted(() => ({
  addCloseListener: vi.fn(),
  addErrorListener: vi.fn(),
  addMessageListener: vi.fn(),
  addMissedMessageListener: vi.fn(),
  close: vi.fn(),
  initialize: vi.fn(),
  userTyping: vi.fn()
}));

vi.mock('@mattermost/client', () => ({
  Client4: class {},
  ClientError: class extends Error {},
  WebSocketClient: class {
    addCloseListener = vendorSocket.addCloseListener;
    addErrorListener = vendorSocket.addErrorListener;
    addMessageListener = vendorSocket.addMessageListener;
    addMissedMessageListener = vendorSocket.addMissedMessageListener;
    close = vendorSocket.close;
    initialize = vendorSocket.initialize;
    userTyping = vendorSocket.userTyping;
  }
}));

const createLoggerMock = () => ({ debug: vi.fn(), error: vi.fn(), log: vi.fn(), verbose: vi.fn(), warn: vi.fn() });

type SocketListener = (event: any) => void;

const createFakeSocket = () => {
  const closeListeners: ((connectFailCount: number) => void)[] = [];
  const errorListeners: SocketListener[] = [];
  const listeners: SocketListener[] = [];
  const missedListeners: (() => void)[] = [];
  return {
    addCloseListener: (listener: (connectFailCount: number) => void) => closeListeners.push(listener),
    addErrorListener: (listener: SocketListener) => errorListeners.push(listener),
    addMessageListener: (listener: SocketListener) => listeners.push(listener),
    addMissedMessageListener: (listener: () => void) => missedListeners.push(listener),
    close: vi.fn(),
    emit: (event: unknown) => listeners.forEach((listener) => listener(event)),
    emitClose: (connectFailCount: number) => closeListeners.forEach((listener) => listener(connectFailCount)),
    emitError: () => errorListeners.forEach((listener) => listener(undefined)),
    emitMissedMessages: () => missedListeners.forEach((listener) => listener()),
    initialize: vi.fn(),
    userTyping: vi.fn()
  };
};

const postedEvent = (overrides: { message?: string; senderName?: string; type?: string } = {}) => ({
  data: {
    channel_type: MattermostChannelType.Open,
    post: JSON.stringify({
      channel_id: 'channel-1',
      create_at: 1700000000000,
      id: 'post-1',
      message: overrides.message ?? 'hello @mira',
      type: overrides.type ?? ''
    }),
    sender_name: overrides.senderName ?? '@casey'
  },
  event: 'posted'
});

const restPost = (overrides: Partial<$MattermostRestPost> = {}): $MattermostRestPost => ({
  channelId: 'channel-1',
  createAt: 1700000000000,
  id: 'post-1',
  message: 'hello',
  originalId: '',
  type: '',
  userId: 'casey-user-id',
  ...overrides
});

describe('MattermostTransport', () => {
  let client: MockedInstance<MattermostClient>;
  let events: ChatEvent[];
  let socket: ReturnType<typeof createFakeSocket>;
  let logger: ReturnType<typeof createLoggerMock>;
  let options: MattermostTransportOptions;
  let transport: MattermostTransport;

  beforeEach(() => {
    vi.clearAllMocks();
    client = MockFactory.createMock(MattermostClient);
    events = [];
    logger = createLoggerMock();
    socket = createFakeSocket();
    options = {
      agent: { username: 'mira' },
      botToken: 'token',
      classifyAuthor: (username) => (username === 'mira' ? 'agent' : 'human'),
      client: client as unknown as MattermostClient,
      logger,
      socket,
      url: 'http://localhost:8065',
      userId: 'mira-user-id'
    };
    transport = new MattermostTransport(options);
    transport.listen((event) => {
      events.push(event);
    });
  });

  const settle = () => new Promise((resolve) => setImmediate(resolve));

  describe('posted events', () => {
    it('should deliver a posted event as an observed post', async () => {
      socket.emit(postedEvent());
      await settle();
      expect(events).toStrictEqual([
        {
          kind: 'posted',
          post: {
            authorKind: 'human',
            authorUsername: 'casey',
            channelId: 'channel-1',
            createdAt: new Date(1700000000000),
            id: 'post-1',
            isDirectMessage: false,
            mentionedUsernames: ['mira'],
            message: 'hello @mira'
          }
        }
      ]);
    });

    it("should not deliver the agent's own posts or protocol posts", async () => {
      socket.emit(postedEvent({ senderName: '@mira' }));
      socket.emit(postedEvent({ type: 'system_join_channel' }));
      await settle();
      expect(events).toHaveLength(0);
    });

    it('should discard a malformed posted event rather than guess at it', async () => {
      socket.emit({ data: { post: 'not json' }, event: 'posted' });
      await settle();
      expect(events).toHaveLength(0);
      expect((logger.error as Mock).mock.calls.length).toBeGreaterThan(0);
    });
  });

  describe('membership events', () => {
    it('should deliver a user_added event about this agent', async () => {
      socket.emit({
        broadcast: { channel_id: 'channel-2', user_id: '' },
        data: { user_id: 'mira-user-id' },
        event: 'user_added'
      });
      await settle();
      expect(events).toStrictEqual([{ agentUsername: 'mira', channelId: 'channel-2', kind: 'user_added_to_channel' }]);
    });

    it('should deliver a user_removed event sent directly to the removed agent', async () => {
      socket.emit({
        broadcast: { channel_id: '', user_id: 'mira-user-id' },
        data: { channel_id: 'channel-2', remover_id: 'admin' },
        event: 'user_removed'
      });
      await settle();
      expect(events).toStrictEqual([
        { agentUsername: 'mira', channelId: 'channel-2', kind: 'user_removed_from_channel' }
      ]);
    });

    it('should ignore membership events about other users', async () => {
      socket.emit({
        broadcast: { channel_id: 'channel-2', user_id: '' },
        data: { user_id: 'someone-else' },
        event: 'user_added'
      });
      await settle();
      expect(events).toHaveLength(0);
    });

    it('should discard a membership event naming no channel rather than guess at it', async () => {
      socket.emit({ broadcast: { channel_id: '' }, data: { user_id: 'mira-user-id' }, event: 'user_added' });
      await settle();
      expect(events).toHaveLength(0);
      expect((logger.error as Mock).mock.calls.length).toBeGreaterThan(0);
    });
  });

  describe('the socket', () => {
    it('should open its own websocket against the derived url when none is injected', () => {
      new MattermostTransport({ ...options, socket: undefined }).listen(() => undefined);
      expect(vendorSocket.initialize).toHaveBeenCalledWith('ws://localhost:8065/api/v4/websocket', 'token');
    });

    it('should log a websocket error', () => {
      socket.emitError();
      expect(logger.error).toHaveBeenCalledOnce();
    });

    it('should log a websocket closure with its fail count', () => {
      socket.emitClose(3);
      expect(logger.warn).toHaveBeenCalledWith('mattermost websocket closed (connectFailCount=3)');
    });

    // the client reconnects on its own; this is the only signal that it could not resume, and
    // without it a mention posted during the gap is never seen live and never triggers (§5.2)
    it('should ask for a resync when the socket reconnects without resuming', () => {
      socket.emitMissedMessages();
      expect(events).toContainEqual({ agentUsername: 'mira', kind: 'resync' });
    });

    it('should close the socket on disconnect', () => {
      transport.disconnect();
      expect(socket.close).toHaveBeenCalledOnce();
    });

    it('should log a failing event handler rather than let it reject unobserved', async () => {
      const otherSocket = createFakeSocket();
      new MattermostTransport({ ...options, socket: otherSocket }).listen(() => {
        throw new Error('handler exploded');
      });
      otherSocket.emit(postedEvent());
      await settle();
      expect(logger.error).toHaveBeenCalledOnce();
    });
  });

  it('should ignore unknown event types', async () => {
    socket.emit({ data: {}, event: 'typing' });
    await settle();
    expect(events).toHaveLength(0);
  });

  it('should return the created post id and creation time from send', async () => {
    client.createPost.mockResolvedValue({ createAt: 1700000000000, id: 'post-9' });
    const sent = await transport.send({ channelId: 'channel-1', text: 'hi' });
    expect(sent.value).toStrictEqual({ createdAt: new Date(1700000000000), postId: 'post-9' });
  });

  it('should surface an api refusal as a chat failure rather than a throw', async () => {
    client.createPost.mockRejectedValue(new Error('refused'));
    const sent = await transport.send({ channelId: 'channel-1', text: 'hi' });
    expect(sent.error).toMatchObject({ kind: 'api', message: 'refused' });
  });

  it('should react as the connected bot user', async () => {
    const reacted = await transport.addReaction('post-1', 'eyes');
    expect(client.addReaction).toHaveBeenCalledWith({ emojiName: 'eyes', postId: 'post-1', userId: 'mira-user-id' });
    expect(reacted.success).toBe(true);
  });

  it('should describe a user by id', async () => {
    client.getUser.mockResolvedValue({ isBot: true, username: 'mira' });
    const described = await transport.describeUser('mira-user-id');
    expect(described.value).toStrictEqual({ isBot: true, username: 'mira' });
  });

  it('should report every channel this bot belongs to', async () => {
    client.getOwnChannelIds.mockResolvedValue(['channel-1', 'channel-2']);
    const memberships = await transport.getChannelMemberships();
    expect(memberships.value).toStrictEqual(['channel-1', 'channel-2']);
  });

  it('should ask the api whether a user is a member of a channel', async () => {
    client.isChannelMember.mockResolvedValue(true);
    const isMember = await transport.isChannelMember('channel-1', 'casey-user-id');
    expect(client.isChannelMember).toHaveBeenCalledWith({ channelId: 'channel-1', userId: 'casey-user-id' });
    expect(isMember.value).toBe(true);
  });

  it('should count direct and group channels as direct messages, and no others', async () => {
    client.getChannelType
      .mockResolvedValueOnce(MattermostChannelType.Direct)
      .mockResolvedValueOnce(MattermostChannelType.Group)
      .mockResolvedValueOnce(MattermostChannelType.Open);
    const answers = [];
    for (const _ of [0, 1, 2]) {
      answers.push((await transport.isDirectMessageChannel('channel-1')).value);
    }
    expect(answers).toStrictEqual([true, true, false]);
  });

  it('should open a dialog through the client', async () => {
    const request = {
      callbackId: 'approval-1',
      elements: [],
      title: 'Deny',
      triggerId: 'trigger-1',
      url: 'http://localhost:3000/decisions'
    };
    await transport.openDialog(request);
    expect(client.openDialog).toHaveBeenCalledWith(request);
  });

  it('should signal typing at the channel rather than in a thread', () => {
    transport.signalTyping('channel-1');
    expect(socket.userTyping).toHaveBeenCalledWith('channel-1', '');
  });

  it('should update a post through the client', async () => {
    await transport.updatePost('post-1', { attachments: [], text: 'edited' });
    expect(client.updatePost).toHaveBeenCalledWith({ attachments: [], message: 'edited', postId: 'post-1' });
  });

  describe('backfill', () => {
    beforeEach(() => {
      client.getChannelType.mockResolvedValue(MattermostChannelType.Direct);
      client.getUsernamesByIds.mockResolvedValue(new Map([['casey-user-id', 'casey']]));
    });

    it('should read recent history oldest first when no post is named, dropping protocol and edit rows', async () => {
      client.getLatestPosts.mockResolvedValue([
        restPost({ createAt: 3, id: 'newer' }),
        restPost({ createAt: 1, id: 'older' }),
        restPost({ id: 'joined', type: 'system_join_channel' }),
        restPost({ id: 'edit-history', originalId: 'older' })
      ]);
      const backfilled = await transport.postsSince('channel-1', undefined);
      expect(client.getLatestPosts).toHaveBeenCalledWith({ channelId: 'channel-1', perPage: 60 });
      expect(backfilled.value).toMatchObject([
        { id: 'older', isDirectMessage: true },
        { id: 'newer', isDirectMessage: true }
      ]);
    });

    it('should skip a post whose author no longer resolves to a user', async () => {
      client.getLatestPosts.mockResolvedValue([restPost({ userId: 'deleted-user-id' })]);
      const backfilled = await transport.postsSince('channel-1', undefined);
      expect(backfilled.value).toStrictEqual([]);
      expect(logger.warn).toHaveBeenCalledOnce();
    });

    it('should page past the named post until a short page comes back', async () => {
      const fullPage = Array.from({ length: 60 }, (_, index) => restPost({ createAt: index, id: `post-${index}` }));
      client.getPostsAfter
        .mockResolvedValueOnce(fullPage)
        .mockResolvedValueOnce([restPost({ createAt: 60, id: 'last' })]);
      const backfilled = await transport.postsSince('channel-1', 'post-0');
      expect(client.getPostsAfter).toHaveBeenLastCalledWith({
        afterPostId: 'post-0',
        channelId: 'channel-1',
        page: 1,
        perPage: 60
      });
      expect(backfilled.value).toHaveLength(61);
    });
  });

  describe('maxPostSizeChars', () => {
    it('should read the substrate limit once and reuse it thereafter (§6.2)', async () => {
      client.getMaxPostSize.mockResolvedValue(4000);
      expect((await transport.maxPostSizeChars()).value).toBe(4000);
      expect((await transport.maxPostSizeChars()).value).toBe(4000);
      expect(client.getMaxPostSize).toHaveBeenCalledOnce();
    });

    it('should surface a read failure without caching it, so a later read can still succeed', async () => {
      client.getMaxPostSize.mockRejectedValueOnce(new Error('config unreachable'));
      expect((await transport.maxPostSizeChars()).success).toBe(false);
      client.getMaxPostSize.mockResolvedValue(4000);
      expect((await transport.maxPostSizeChars()).value).toBe(4000);
    });
  });
});
