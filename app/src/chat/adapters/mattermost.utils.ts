import { Result, toErrorMessage } from '@collegium/core/utils';
import { ClientError } from '@mattermost/client';

import type { ObservedPost } from '@/conversations/conversations.types.ts';
import type { AuthorKind } from '@/prisma/prisma.types.ts';
import { extractMentionedUsernames } from '@/utils/mention.utils.ts';

import { MattermostChannelType } from './mattermost.constants.ts';

import type { AuthorClassifier, ChatFailure } from '../chat.types.ts';
import type { $MattermostPostedEventMessage } from './mattermost.schemas.ts';

export function classifyAuthor(
  username: string,
  identities: { agentUsernames: ReadonlySet<string>; systemBotUsername: string }
): AuthorKind {
  if (username === identities.systemBotUsername) {
    return 'system';
  }
  return identities.agentUsernames.has(username) ? 'agent' : 'human';
}

export function isSystemPost(post: { type: string }): boolean {
  return post.type.startsWith('system_');
}

export function toUsername(senderName: string): string {
  return senderName.replace(/^@/, '').toLowerCase();
}

export function buildObservedPost(input: {
  authorUsername: string;
  channelId: string;
  classify: AuthorClassifier;
  createAt: number;
  id: string;
  isDirectMessage: boolean;
  message: string;
}): ObservedPost {
  const authorUsername = toUsername(input.authorUsername);
  return {
    authorKind: input.classify(authorUsername),
    authorUsername,
    channelId: input.channelId,
    createdAt: new Date(input.createAt),
    id: input.id,
    isDirectMessage: input.isDirectMessage,
    mentionedUsernames: extractMentionedUsernames(input.message),
    message: input.message
  };
}

export function toObservedPost({ data }: $MattermostPostedEventMessage, classify: AuthorClassifier): ObservedPost {
  return buildObservedPost({
    authorUsername: data.senderName,
    channelId: data.post.channelId,
    classify,
    createAt: data.post.createAt,
    id: data.post.id,
    isDirectMessage: data.channelType === MattermostChannelType.Direct,
    message: data.post.message
  });
}

export function toChatFailure(error: unknown): ChatFailure {
  return {
    kind: 'api',
    message: toErrorMessage(error),
    ...(error instanceof ClientError && typeof error.status_code === 'number' && { status: error.status_code })
  };
}

/** the Mattermost seam's one try/catch: every vendor call becomes a Result the caller must branch on */
export async function toChatResult<TValue>(operation: () => Promise<TValue>): Promise<Result<TValue, ChatFailure>> {
  try {
    return Result.ok(await operation());
  } catch (error) {
    return Result.err(toChatFailure(error));
  }
}

export function toWebsocketUrl(baseUrl: string): string {
  return `${baseUrl.replace(/^http/, 'ws')}/api/v4/websocket`;
}
