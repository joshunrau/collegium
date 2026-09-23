import { SUPERSEDABLE_RETENTION_FLOOR } from '../../retention/retention.constants.ts';
import { retentionBudgetFor } from '../../retention/retention.utils.ts';
import { formatApproximateTokens } from '../prompt.utils.ts';

import type { StablePromptInput } from '../prompt.types.ts';

export function renderContextBudgetPreamble({ profile, supersedableCalls, textFormatter }: StablePromptInput): string {
  const retention =
    supersedableCalls.length === 0
      ? "Each tool result in a turn stays in that turn's context."
      : textFormatter.formatParagraphs(
          [
            'In one turn, results of {foldingCalls} are kept word for word up to about {retainedResultTokens} tokens of them and never fewer than the {retainedResultFloor} most recent. Once more than that is held, the earliest one you have already read is replaced by a line naming what was read and its size. Making the call again returns the text and may replace another result the same way; within this turn, a result identical to one still shown is not kept twice. Results of calls made together in one response arrive together. Text you write yourself is never replaced.'
          ],
          {
            foldingCalls: textFormatter.formatConjunction(supersedableCalls),
            retainedResultFloor: SUPERSEDABLE_RETENTION_FLOOR,
            retainedResultTokens: formatApproximateTokens(retentionBudgetFor(profile))
          }
        );
  return textFormatter.formatParagraphs(
    [
      "The framework fits the recent posts and records in this channel to about {contextBudgetTokens} tokens and leaves out the oldest. Your instructions, the framework's message after the posts, your tool definitions and this turn's own results are not counted against that number. The whole of your context in one turn is kept under about {turnContextCeilingTokens} tokens. {retention} A result too large for the room that remains is cut and ends with a line saying so; the framework's record keeps all of it."
    ],
    {
      contextBudgetTokens: profile.contextBudgetTokens,
      retention,
      turnContextCeilingTokens: formatApproximateTokens(profile.turnContextCeilingTokens)
    }
  );
}
