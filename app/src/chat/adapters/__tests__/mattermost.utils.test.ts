import { ClientError } from '@mattermost/client';
import { describe, expect, it } from 'vitest';

import { extractMentionedUsernames } from '@/utils/mention.utils.ts';

import { MattermostChannelType } from '../mattermost.constants.ts';
import { createAuthorClassifier, isSystemPost, toChatFailure, toObservedPost } from '../mattermost.utils.ts';

import type { $MattermostPostedEventMessage } from '../mattermost.schemas.ts';

const IDENTITIES = { agentUsernames: new Set(['mira', 'tess']), systemBotUsername: 'collegium' };

const event = (
  overrides: Partial<$MattermostPostedEventMessage['data']> = {},
  post: Partial<$MattermostPostedEventMessage['data']['post']> = {}
): $MattermostPostedEventMessage => ({
  data: {
    channelType: MattermostChannelType.Open,
    post: {
      channelId: 'channel-1',
      createAt: 1700000000000,
      id: 'post-1',
      message: 'hello @mira',
      type: '',
      ...post
    },
    senderName: '@casey',
    ...overrides
  },
  event: 'posted'
});

describe('createAuthorClassifier', () => {
  it('should classify an agent, the system bot, and everyone else as human', () => {
    expect(createAuthorClassifier(IDENTITIES)('mira')).toBe('agent');
    expect(createAuthorClassifier(IDENTITIES)('collegium')).toBe('system');
    expect(createAuthorClassifier(IDENTITIES)('casey')).toBe('human');
  });
});

describe('extractMentionedUsernames', () => {
  it('should extract each mentioned username once, lowercased', () => {
    expect(extractMentionedUsernames('@Mira please ask @tess, @mira')).toStrictEqual(['mira', 'tess']);
  });
});

describe('isSystemPost', () => {
  it('should recognise a protocol post by its system_* type', () => {
    expect(isSystemPost(event({}, { type: 'system_join_channel' }).data.post)).toBe(true);
    expect(isSystemPost(event().data.post)).toBe(false);
  });
});

describe('toChatFailure', () => {
  it('should carry the status code of a refusal that came from the Mattermost API', () => {
    const error = new ClientError('http://localhost:8065', { message: 'forbidden', status_code: 403 });
    expect(toChatFailure(error)).toStrictEqual({ kind: 'api', message: 'forbidden', status: 403 });
  });

  it('should report a status-less failure as an api failure without a status', () => {
    expect(toChatFailure(new Error('the socket died'))).toStrictEqual({ kind: 'api', message: 'the socket died' });
  });
});

describe('toObservedPost', () => {
  it('should carry the classified author kind and the post creation time', () => {
    const observed = toObservedPost(event(), createAuthorClassifier(IDENTITIES));
    expect(observed).toStrictEqual({
      authorKind: 'human',
      authorUsername: 'casey',
      channelId: 'channel-1',
      createdAt: new Date(1700000000000),
      id: 'post-1',
      isDirectMessage: false,
      mentionedUsernames: ['mira'],
      message: 'hello @mira'
    });
  });

  it('should mark a direct channel post as a direct message', () => {
    const observed = toObservedPost(event({ channelType: MattermostChannelType.Direct }), () => 'human');
    expect(observed.isDirectMessage).toBe(true);
  });
});
