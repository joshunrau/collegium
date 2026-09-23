import type { StablePromptInput } from '../prompt.types.ts';

export function renderTurnStartsPreamble({ foldLimit, textFormatter }: StablePromptInput): string {
  return textFormatter.formatParagraphs(
    [
      "Nothing of yours runs after the turn stops. A post that arrived while you were working starts a new turn as soon as this one ends normally. That post sits in the new turn's context at the time it arrived, which is before your own last reply and not at the end; it is the turn's job even when your own text follows it. While you are working, a further post by the same person that addresses nobody may instead be added to this turn: the framework discards the answer it had just received from you, rebuilds your context with that post in it, and you begin the turn again, at most {foldLimit} times in one turn. Otherwise the next turn here begins when a person posts, a colleague mentions you, or a trigger fires. A person can also hand an instruction into a turn that is already running: it arrives in the same form as a post, with that person's name, between your results, and it spends one attempt. Nothing a tool returns ever takes that form."
    ],
    { foldLimit }
  );
}
