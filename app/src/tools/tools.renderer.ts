import { renderDenialLine } from '@/approvals/approvals.renderer.ts';

/**
 * §5.4 — a reasoned denial is a person's decision the turn continues under, and reads as one rather
 * than as a tool error: told only `denied: <reason>`, one model reported the tool as broken and
 * another ended its turn believing it needed fresh permission.
 */
export function renderToolDenialResult(input: { byUsername: string; displayName: string; reason: string }): string {
  return [
    renderDenialLine({ byUsername: input.byUsername, reason: input.reason, subject: input.displayName }),
    '',
    "This is a person's decision, not a tool error. The turn continues under the same budget: you may act on the reason, including by making this call differently, or reply."
  ].join('\n');
}

/** §3.7a — an answer is a person's words, named as such, so the model does not read it as a tool's */
export function renderAskAnswerResult(input: { answerText: string; byUsername: string }): string {
  return `${input.byUsername} answered: ${input.answerText}`;
}
