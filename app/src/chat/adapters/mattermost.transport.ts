import { Result } from '@collegium/core/utils';
import { WebSocketClient } from '@mattermost/client';
import type { WebSocketMessage } from '@mattermost/client';
import type { LoggerService } from '@nestjs/common';

import type { AgentIdentity } from '@/agents/agents.types.ts';
import type { ObservedPost } from '@/conversations/conversations.types.ts';

import { ChatTransport } from '../chat.transport.ts';
import { MattermostChannelType } from './mattermost.constants.ts';
import {
  $MattermostPostedEventMessage,
  $MattermostUserAddedEventMessage,
  $MattermostUserRemovedEventMessage
} from './mattermost.schemas.ts';
import {
  buildObservedPost,
  isSystemPost,
  toChatResult,
  toObservedPost,
  toUsername,
  toWebsocketUrl
} from './mattermost.utils.ts';

import type {
  AuthorClassifier,
  ChatEvent,
  ChatEventHandler,
  ChatFailure,
  DialogRequest,
  OutgoingChatMessage,
  PostUpdate
} from '../chat.types.ts';
import type { MattermostClient } from './mattermost.client.ts';

const BACKFILL_PAGE_SIZE = 60;

type MattermostSocket = Pick<
  WebSocketClient,
  'addCloseListener' | 'addErrorListener' | 'addMessageListener' | 'close' | 'initialize' | 'userTyping'
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

  postsSince(channelId: string, postId: string | undefined): Promise<Result<ObservedPost[], ChatFailure>> {
    return toChatResult(async () => {
      const raw = (postId === undefined ? await this.latestPosts(channelId) : await this.postsAfter(channelId, postId))
        .filter((post) => !isSystemPost(post) && post.originalId === '')
        .toSorted((left, right) => left.createAt - right.createAt);
      const isDirectMessage = (await this.client.getChannelType(channelId)) === MattermostChannelType.Direct;
      const usernames = await this.client.getUsernamesByIds([...new Set(raw.map((post) => post.userId))]);
      return raw.flatMap((post): ObservedPost[] => {
        const authorUsername = usernames.get(post.userId);
        if (authorUsername === undefined) {
          this.logger.warn(`skipped backfilling post ${post.id}: its author no longer resolves to a user`);
          return [];
        }
        return [
          buildObservedPost({
            authorUsername,
            channelId,
            classify: this.classifyAuthor,
            createAt: post.createAt,
            id: post.id,
            isDirectMessage,
            message: post.message
          })
        ];
      });
    });
  }

  send(message: OutgoingChatMessage): Promise<Result<{ createdAt: Date; postId: string }, ChatFailure>> {
    return toChatResult(async () => {
      const created = await this.client.createPost({
        attachments: message.attachments,
        channelId: message.channelId,
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
    return toChatResult(() =>
      this.client.updatePost({ attachments: update.attachments, message: update.text, postId })
    );
  }

  private async handleEvent(event: WebSocketMessage, onEvent: ChatEventHandler): Promise<void> {
    switch (event.event) {
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
    if (result.data.userId !== this.userId) {
      return;
    }
    await onEvent({
      agentUsername: this.agent.username,
      channelId: result.data.channelId,
      kind: event.event === 'user_added' ? 'user_added_to_channel' : 'user_removed_from_channel'
    } satisfies ChatEvent.Membership);
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
}
