import type { StablePromptInput } from '../prompt.types.ts';

export function renderSearchPreamble({ granted }: StablePromptInput): string | undefined {
  if (!granted.some(({ id: [namespace, tool] }) => namespace === 'conversations' && tool === 'search')) {
    return undefined;
  }
  return "conversations__search finds past posts in the channels you are in. It reaches only channels every reader of this one could already read. It finds posts by people, colleagues, the system bot and you, but not status text or framework notices, and it does not reach past a channel's most recent episode boundary, the one the system bot announced there. A match is the post as it was written, cut to a window around the match where the post is long and readable whole by passing its id as postId: it names who posted it and where, not where they got what they wrote.";
}
