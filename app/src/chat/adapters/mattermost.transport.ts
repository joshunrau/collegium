import { Result } from '@collegium/core/utils';
import { WebSocketClient } from '@mattermost/client';
import type { WebSocketMessage } from '@mattermost/client';
import type { LoggerService } from '@nestjs/common';

import type { AgentIdentity } from '@/agents/agents.types.ts';
import type { ObservedPost, RecordablePost } from '@/conversations/conversations.types.ts';

import { ChatTransport } from '../chat.transport.ts';
import { MattermostChannelType } from './mattermost.constants.ts';
import {
  $MattermostPostDeletedEventMessage,
  $MattermostPostedEventMessage,
  $MattermostPostEditedEventMessage,
  $MattermostUserAddedEventMessage,
  $MattermostUserRemovedEventMessage
} from './mattermost.schemas.ts';
import {
  buildObservedPost,
  buildRecordablePost,
  isSystemPost,
  toChannelKind,
  toChatResult,
  toObservedPost,
  toPostAttachments,
  toUsername,
  toWebsocketUrl
} from './mattermost.utils.ts';

import type {
  AuthorClassifier,
  ChannelDescription,
  ChatEvent,
  ChatEventHandler,
  ChatFailure,
  DialogRequest,
  OutgoingChatMessage,
  PostUpdate
} from '../chat.types.ts';
import type { MattermostClient } from './mattermost.client.ts';
import type { $MattermostRestPost } from './mattermost.schemas.ts';

const BACKFILL_PAGE_SIZE = 60;

type MattermostSocket = Pick<
  WebSocketClient,
  | 'addCloseListener'
  | 'addErrorListener'
  | 'addMessageListener'
  | 'addMissedMessageListener'
  | 'close'
  | 'initialize'
  | 'userTyping'
>;

export type MattermostTransportOptions = {
  agent: AgentIdentity;
  botToken: string;
  classifyAuthor: AuthorClassifier;
  client: MattermostClient;
  logger: LoggerService;
  socket?: MattermostSocket;
  url: string;
  userId: string;
};

export class MattermostTransport extends ChatTransport {
  private readonly agent: AgentIdentity;
  private readonly botToken: string;
  // MaxPostSize is a server setting that changes rarely; read once behind the seam and reused (§6.2)
  private cachedMaxPostSize: number | undefined;
  private readonly classifyAuthor: AuthorClassifier;
  private readonly client: MattermostClient;
  private readonly logger: LoggerService;
  private readonly socket: MattermostSocket;
  private readonly url: string;
  private readonly userId: string;

  constructor(options: MattermostTransportOptions) {
    super();
    this.agent = options.agent;
    this.botToken = options.botToken;
    this.classifyAuthor = options.classifyAuthor;
    this.client = options.client;
    this.logger = options.logger;
    this.socket = options.socket ?? new WebSocketClient();
    this.url = options.url;
    this.userId = options.userId;
  }

  addReaction(postId: string, emoji: string): Promise<Result<void, ChatFailure>> {
    return toChatResult(() => this.client.addReaction({ emojiName: emoji, postId, userId: this.userId }));
  }

  describeChannel(channelId: string): Promise<Result<ChannelDescription, ChatFailure>> {
    return toChatResult(async () => {
      const [channel, memberUsernames] = await Promise.all([
        this.client.getChannel(channelId),
        this.client.getChannelMemberUsernames(channelId)
      ]);
      return { displayName: channel.displayName, kind: toChannelKind(channel.type), memberUsernames };
    });
  }

  describeUser(userId: string): Promise<Result<{ isBot: boolean; username: string }, ChatFailure>> {
    return toChatResult(() => this.client.getUser(userId));
  }

  disconnect(): void {
    this.socket.close();
  }

  getChannelMemberships(): Promise<Result<string[], ChatFailure>> {
    return toChatResult(() => this.client.getOwnChannelIds());
  }

  isChannelMember(channelId: string, userId: string): Promise<Result<boolean, ChatFailure>> {
    return toChatResult(() => this.client.isChannelMember({ channelId, userId }));
  }

  isDirectMessageChannel(channelId: string): Promise<Result<boolean, ChatFailure>> {
    return toChatResult(async () => {
      const type = await this.client.getChannelType(channelId);
      return type === MattermostChannelType.Direct || type === MattermostChannelType.Group;
    });
  }

  listen(onEvent: ChatEventHandler): void {
    this.socket.addMessageListener((event) => {
      this.handleEvent(event, onEvent).catch((error: unknown) => {
        this.logger.error(new Error('failed to handle mattermost event', { cause: error }));
      });
    });

    this.socket.addErrorListener(() => {
      this.logger.error(new Error('mattermost websocket error'));
    });

    this.socket.addCloseListener((connectFailCount) => {
      this.logger.warn(`mattermost websocket closed (connectFailCount=${connectFailCount})`);
    });

    // the client reconnects on its own, and fires this when it could not resume the session — the
    // one signal that events were dropped. Without it a mention posted during a blip is never seen
    // live and never triggers, since §8.2 backfill only runs at boot and never activates.
    this.socket.addMissedMessageListener(() => {
      this.logger.warn('mattermost websocket reconnected without resuming; re-reading channels');
      void Promise.resolve(
        onEvent({ agentUsername: this.agent.username, kind: 'resync' } satisfies ChatEvent.Resync)
      ).catch((error: unknown) => {
        this.logger.error(new Error('failed to repair missed mattermost events', { cause: error }));
      });
    });

    this.socket.initialize(toWebsocketUrl(this.url), this.botToken);
  }

  async maxPostSizeChars(): Promise<Result<number, ChatFailure>> {
    if (this.cachedMaxPostSize !== undefined) {
      return Result.ok(this.cachedMaxPostSize);
    }
    const result = await toChatResult(() => this.client.getMaxPostSize());
    if (result.success) {
      this.cachedMaxPostSize = result.value;
    }
    return result;
  }

  openDialog(request: DialogRequest): Promise<Result<void, ChatFailure>> {
    return toChatResult(() => this.client.openDialog(request));
  }

  pinnedPosts(channelId: string): Promise<Result<RecordablePost[], ChatFailure>> {
    return toChatResult(async () => {
      const authored = await this.withAuthors(await this.client.getPinnedPosts(channelId));
      return authored.map(({ authorUsername, post }) => {
        return buildRecordablePost({
          attachments: toPostAttachments(post.fileIds, post.metadata.files),
          authorUsername,
          channelId,
          classify: this.classifyAuthor,
          createAt: post.createAt,
          id: post.id,
          message: post.message
        });
      });
    });
  }

  postsSince(channelId: string, postId: string | undefined): Promise<Result<ObservedPost[], ChatFailure>> {
    return toChatResult(async () => {
      const authored = await this.withAuthors(
        postId === undefined ? await this.latestPosts(channelId) : await this.postsAfter(channelId, postId)
      );
      const isDirectMessage = (await this.client.getChannelType(channelId)) === MattermostChannelType.Direct;
      return authored.map(({ authorUsername, post }) => {
        return buildObservedPost({
          attachments: toPostAttachments(post.fileIds, post.metadata.files),
          authorUsername,
          channelId,
          classify: this.classifyAuthor,
          createAt: post.createAt,
          id: post.id,
          isDirectMessage,
          message: post.message
        });
      });
    });
  }

  send(message: OutgoingChatMessage): Promise<Result<{ createdAt: Date; postId: string }, ChatFailure>> {
    return toChatResult(async () => {
      const fileIds = await Promise.all(
        (message.files ?? []).map((file) => {
          return this.client.uploadFile({
            channelId: message.channelId,
            content: file.content,
            filename: file.filename
          });
        })
      );
      const created = await this.client.createPost({
        attachments: message.attachments,
        channelId: message.channelId,
        ...(fileIds.length > 0 && { fileIds }),
        message: message.text
      });
      return { createdAt: new Date(created.createAt), postId: created.id };
    });
  }

  /** the empty parent id is channel-level rather than thread-level: nothing here posts into a thread */
  signalTyping(channelId: string): void {
    this.socket.userTyping(channelId, '');
  }

  updatePost(postId: string, update: PostUpdate): Promise<Result<void, ChatFailure>> {
    return toChatResult(() => {
      return this.client.updatePost({ attachments: update.attachments, message: update.text, postId });
    });
  }

  private async handleEvent(event: WebSocketMessage, onEvent: ChatEventHandler): Promise<void> {
    switch (event.event) {
      case 'post_deleted':
        return this.handlePostDeletedEvent(event, onEvent);
      case 'post_edited':
        return this.handlePostEditedEvent(event, onEvent);
      case 'posted':
        return this.handlePostedEvent(event, onEvent);
      case 'user_added':
      case 'user_removed':
        return this.handleMembershipEvent(event, onEvent);
      default:
        return;
    }
  }

  private async handleMembershipEvent(event: WebSocketMessage, onEvent: ChatEventHandler): Promise<void> {
    const schema = event.event === 'user_added' ? $MattermostUserAddedEventMessage : $MattermostUserRemovedEventMessage;
    const result = schema.safeParse(event);
    if (!result.success) {
      this.logger.error(new Error(`discarded a malformed mattermost "${event.event}" event`, { cause: result.error }));
      return;
    }
    const username = await this.resolveUsername(result.data.userId);
    if (username === undefined) {
      this.logger.warn(`dropped a "${event.event}" event: user ${result.data.userId} no longer resolves to a user`);
      return;
    }
    await onEvent({
      agentUsername: this.agent.username,
      channelId: result.data.channelId,
      kind: event.event === 'user_added' ? 'user_added_to_channel' : 'user_removed_from_channel',
      username
    } satisfies ChatEvent.Membership);
  }

  /** a deleted post is no longer pinned in Mattermost, whatever it was; the store keeps its copy (§8.2) */
  private async handlePostDeletedEvent(event: WebSocketMessage, onEvent: ChatEventHandler): Promise<void> {
    const result = $MattermostPostDeletedEventMessage.safeParse(event);
    if (!result.success) {
      this.logger.error(new Error(`discarded a malformed mattermost "post_deleted" event`, { cause: result.error }));
      return;
    }
    await onEvent({ kind: 'unpinned', postId: result.data.data.post.id } satisfies ChatEvent.Unpinned);
  }

  private async handlePostedEvent(event: WebSocketMessage, onEvent: ChatEventHandler): Promise<void> {
    const result = $MattermostPostedEventMessage.safeParse(event);
    if (!result.success) {
      this.logger.error(new Error(`discarded a malformed mattermost "posted" event`, { cause: result.error }));
      return;
    }
    if (isSystemPost(result.data.data.post) || this.isOwnPost(result.data)) {
      return;
    }
    await onEvent({ kind: 'posted', post: toObservedPost(result.data, this.classifyAuthor) });
  }

  private async handlePostEditedEvent(event: WebSocketMessage, onEvent: ChatEventHandler): Promise<void> {
    const result = $MattermostPostEditedEventMessage.safeParse(event);
    if (!result.success) {
      this.logger.error(new Error(`discarded a malformed mattermost "post_edited" event`, { cause: result.error }));
      return;
    }
    const { post } = result.data.data;
    if (isSystemPost(post)) {
      return;
    }
    if (!post.isPinned) {
      await onEvent({ kind: 'unpinned', postId: post.id } satisfies ChatEvent.Unpinned);
      return;
    }
    const authorUsername = await this.resolveUsername(post.userId);
    if (authorUsername === undefined) {
      this.logger.warn(`dropped a pin of post ${post.id}: its author no longer resolves to a user`);
      return;
    }
    await onEvent({
      kind: 'pinned',
      post: buildRecordablePost({
        attachments: toPostAttachments(post.fileIds, post.metadata.files),
        authorUsername,
        channelId: post.channelId,
        classify: this.classifyAuthor,
        createAt: post.createAt,
        id: post.id,
        message: post.message
      })
    } satisfies ChatEvent.Pinned);
  }

  private isOwnPost({ data }: $MattermostPostedEventMessage): boolean {
    return toUsername(data.senderName) === this.agent.username;
  }

  private async latestPosts(channelId: string) {
    return this.client.getLatestPosts({ channelId, perPage: BACKFILL_PAGE_SIZE });
  }

  private async postsAfter(channelId: string, afterPostId: string) {
    const collected = [];
    for (let page = 0; ; page++) {
      const batch = await this.client.getPostsAfter({ afterPostId, channelId, page, perPage: BACKFILL_PAGE_SIZE });
      collected.push(...batch);
      if (batch.length < BACKFILL_PAGE_SIZE) {
        return collected;
      }
    }
  }

  private async resolveUsername(userId: string): Promise<string | undefined> {
    if (userId === this.userId) {
      return this.agent.username;
    }
    return (await this.client.getUsernamesByIds([userId])).get(userId);
  }

  /** a read's real posts, oldest first, each beside its author's username; one whose author no longer resolves is skipped */
  private async withAuthors(
    raw: readonly $MattermostRestPost[]
  ): Promise<{ authorUsername: string; post: $MattermostRestPost }[]> {
    const posts = raw
      .filter((post) => !isSystemPost(post) && post.originalId === '')
      .toSorted((left, right) => left.createAt - right.createAt);
    const usernames = await this.client.getUsernamesByIds([...new Set(posts.map((post) => post.userId))]);
    return posts.flatMap((post) => {
      const authorUsername = usernames.get(post.userId);
      if (authorUsername === undefined) {
        this.logger.warn(`skipped reading post ${post.id}: its author no longer resolves to a user`);
        return [];
      }
      return [{ authorUsername, post }];
    });
  }
}
