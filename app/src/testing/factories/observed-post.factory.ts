import type { ObservedPost } from '@/conversations/conversations.types.ts';

export function createObservedPost(overrides: Partial<ObservedPost> = {}): ObservedPost {
  return {
    authorKind: 'human',
    authorUsername: 'casey',
    channelId: 'channel-1',
    createdAt: new Date(),
    id: 'post-1',
    isDirectMessage: false,
    mentionedUsernames: [],
    message: 'hello',
    ...overrides
  };
}
