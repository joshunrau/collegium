import { formatCount } from '../prompt.utils.ts';

import type { StablePromptInput } from '../prompt.types.ts';

export function renderMemoryPreamble({ memoryCaps, textFormatter }: StablePromptInput): string | undefined {
  if (memoryCaps === undefined) {
    return undefined;
  }
  return textFormatter.formatParagraphs(
    [
      "Your memories go with you between channels, and stay in your context after the posts and results around them have fallen outside it. Writing, revising and deleting a memory need no approval. Each one is recorded: your status post names the call, and the framework's record keeps the description and the body. The text of a memory is not posted in the channel. A memory's description holds at most {maxDescriptionChars} characters and its body at most {maxBodyChars}. You keep at most {maxEntries} memories; a write beyond that removes the one whose body you read longest ago, and its result names it. Your memories are yours alone: no colleague can read them, and you cannot read theirs."
    ],
    {
      maxBodyChars: formatCount(memoryCaps.maxBodyChars),
      maxDescriptionChars: formatCount(memoryCaps.maxDescriptionChars),
      maxEntries: formatCount(memoryCaps.maxEntries)
    }
  );
}
