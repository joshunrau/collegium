import { viewCapCharsFor } from '../../retention/retention.utils.ts';
import { formatApproximateTokens, formatCount } from '../prompt.utils.ts';

import type { StablePromptInput } from '../prompt.types.ts';

export function renderContextBudgetPreamble({ profile, textFormatter }: StablePromptInput): string {
  return textFormatter.formatParagraphs(
    [
      "The framework fits the recent posts and records in this channel to about {contextBudgetTokens} tokens and leaves out the oldest. Your instructions, the framework's message after the posts, your tool definitions and this turn's own results are not counted against that number. The whole of your context in one turn is kept under about {turnContextCeilingTokens} tokens.",
      'A result longer than about {viewChars} characters, or than the narrower view its tool keeps, comes as its first part, its whole size and a reference such as r7; results__read reads on from an offset or finds phrases in it, and each read counts against your action budget. When your context nears its limit, a result you have already read may be shown as one line with its reference and the time it was recorded, and results__read shows it again as it was then. Nothing is lost: the framework keeps every result whole. Within this turn, a result identical to one still shown is not kept twice. Text you write yourself is never replaced.'
    ],
    {
      contextBudgetTokens: profile.contextBudgetTokens,
      turnContextCeilingTokens: formatApproximateTokens(profile.turnContextCeilingTokens),
      viewChars: formatCount(viewCapCharsFor(profile))
    }
  );
}
