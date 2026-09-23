import type { StablePromptInput } from '../prompt.types.ts';

export function renderAttemptsPreamble({ budgetExemptCalls, profile, textFormatter }: StablePromptInput): string {
  return textFormatter.formatParagraphs(
    [
      'Each turn has {actionBudget} attempts. A tool call spends one. So does a call a person denied, a call whose arguments do not parse, a reply the framework refuses, and an instruction a person hands you mid-turn. Calls to {budgetExemptCalls} spend none. When the attempts are used, the framework asks a person for more. If the person agrees, you get {actionBudget} more. A refusal with no reason stops the turn; a refusal with a reason comes back to you, no further tool call runs, and your next text is posted as your reply.'
    ],
    {
      actionBudget: profile.actionBudget,
      budgetExemptCalls: textFormatter.formatConjunction(budgetExemptCalls)
    }
  );
}
