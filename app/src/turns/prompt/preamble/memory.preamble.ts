import type { StablePromptInput } from '../prompt.types.ts';

export function renderMemoryPreamble({ granted }: StablePromptInput): string | undefined {
  if (!granted.some(({ id: [namespace] }) => namespace === 'memory')) {
    return undefined;
  }
  return "Your memories go with you between channels, and stay in your context after the posts and results around them have fallen outside it. Writing, revising and deleting a memory need no approval. Each one is recorded: your status post names the call, and the framework's record keeps the description and the body. The text of a memory is not posted in the channel.";
}
