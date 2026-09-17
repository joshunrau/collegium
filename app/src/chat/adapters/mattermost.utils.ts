import { Result, toErrorMessage } from '@collegium/core/utils';
import { ClientError } from '@mattermost/client';

import type { ObservedPost, PostAttachment } from '@/conversations/conversations.types.ts';
import { extractMentionedUsernames } from '@/utils/mention.utils.ts';

import { MattermostChannelType } from './mattermost.constants.ts';

import type { AuthorClassifier, ChannelKind, ChatFailure } from '../chat.types.ts';
import type { $MattermostPostedEventMessage } from './mattermost.schemas.ts';

/** who a post's author is, judged against the accounts this deployment declares; everyone else is human */
export function createAuthorClassifier(identities: {
  agentUsernames: ReadonlySet<string>;
  systemBotUsername: string;
}): AuthorClassifier {
  return (username) => {
    if (username === identities.systemBotUsername) {
      return 'system';
    }
    return identities.agentUsernames.has(username) ? 'agent' : 'human';
  };
}

export function isSystemPost(post: { type: string }): boolean {
  return post.type.startsWith('system_');
}

export function toUsername(senderName: string): string {
  return senderName.replace(/^@/, '').toLowerCase();
}

/**
 * Every file the post named, joined to the metadata describing it. Mattermost does not always send
 * that metadata, so an id it left undescribed still yields an attachment — the window says out loud
 * that the file has no name rather than dropping it (§3.8).
 */
export function toPostAttachments(
  fileIds: readonly string[],
  files: readonly PostAttachment[]
): readonly PostAttachment[] {
  return fileIds.map((id) => files.find((file) => file.id === id) ?? { id, mimeType: '', name: '', size: 0 });
}

export function buildObservedPost(input: {
  attachments: readonly PostAttachment[];
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
    attachments: input.attachments,
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
    attachments: toPostAttachments(data.post.fileIds, data.post.metadata.files),
    authorUsername: data.senderName,
    channelId: data.post.channelId,
    classify,
    createAt: data.post.createAt,
    id: data.post.id,
    isDirectMessage: data.channelType === MattermostChannelType.Direct,
    message: data.post.message
  });
}

/** the client-side Threads view is never a real channel, so meeting it here is a vendor contract break */
export function toChannelKind(type: MattermostChannelType): ChannelKind {
  switch (type) {
    case MattermostChannelType.Direct:
      return 'direct';
    case MattermostChannelType.Group:
      return 'group';
    case MattermostChannelType.Open:
      return 'open';
    case MattermostChannelType.Private:
      return 'private';
    case MattermostChannelType.Threads:
      throw new Error('the threads view is not a channel');
  }
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
