import { RECENT_ACTION_LINES } from '../prompt.constants.ts';

import type { StablePromptInput } from '../prompt.types.ts';

export function renderEarlierActionsPreamble({ textFormatter }: StablePromptInput): string {
  return textFormatter.formatParagraphs(
    [
      'Lines under Earlier in this channel are what you did here in earlier turns, beyond where your context reaches, at most {recentActionLines} of them, newest first. They say what you did, not what you learned or what a result said. Making a call again produces its text a second time, at the same cost as the first. A long result of yours from an earlier turn reads as one of those lines in place of its text, where the call itself still shows; you read that text in full in the turn that made the call.'
    ],
    { recentActionLines: RECENT_ACTION_LINES }
  );
}
