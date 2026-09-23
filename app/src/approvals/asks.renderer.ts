import { match } from 'ts-pattern';

import type { MessageAttachment } from '@/chat/chat.types.ts';

import { DECISION_GLYPHS } from './approvals.constants.ts';

import type { AskDecision } from './asks.types.ts';
import type { DecisionFailure } from './decisions/decisions.types.ts';

/**
 * A question has no §6.2 payload, so nothing here attaches or refuses over `MaxPostSize` the way
 * `approvals.renderer.ts` does: the tool's own schema bounds the question and every option, and the
 * preface is bounded here, so a prompt that will not fit in a post cannot be constructed.
 */

/** §3.7a — the preface is model prose under no schema, so it is held to the question's own bound */
const MAX_PREFACE_CHARS = 2000;

/** the label of the button that opens the free-text dialog, offered whether or not options were */
const FREE_TEXT_ACTION_NAME = 'Answer…';

/** Mattermost's action route rejects a hyphenated action id, so the ids are plain alphanumerics */
const FREE_TEXT_ACTION_ID = 'answer';

function capPreface(preface: string): string {
  const trimmed = preface.trim();
  if (trimmed.length <= MAX_PREFACE_CHARS) {
    return trimmed;
  }
  return `${trimmed.slice(0, MAX_PREFACE_CHARS)}…`;
}

export type AskPromptInput = {
  /** already in display form: `ns::tool` */
  readonly actionName: string;
  /** §3.7a — the turn's own line above the question, authored by the turn */
  readonly contextText?: string;
  readonly options?: readonly string[];
  /** §3.7a — what the turn wrote alongside the call: the agent's own reason for asking, in its words */
  readonly preface?: string;
  readonly question: string;
};

/** §3.7a — the question as the channel reads it, under the agent's own account and styled like an approval */
export function renderAskPrompt(input: AskPromptInput): string {
  const lead = `${DECISION_GLYPHS.ask} **Answer needed: \`${input.actionName}\`**`;
  const preface = input.preface === undefined ? [] : [capPreface(input.preface)];
  const offered = input.options === undefined ? [] : [`Offered answers: ${input.options.join(' · ')}`];
  return [
    input.contextText === undefined ? lead : `${lead}\n${input.contextText}`,
    ...preface,
    input.question,
    ...offered
  ].join('\n\n');
}

/** once answered or cancelled, the prompt is rewritten into a terminal state and its buttons removed (§3.7a) */
export function renderResolvedAskPrompt(input: AskPromptInput, decision: AskDecision): string {
  const line = match(decision)
    .with({ kind: 'answered' }, ({ byUsername }) => `💬 **Answered** by @${byUsername}`)
    .with({ kind: 'cancelled' }, ({ reason }) => {
      return match(reason)
        .with('halt', () => '⛔ **No longer awaiting an answer** — a global halt interrupted this turn')
        .with('kill', () => '⛔ **No longer awaiting an answer** — the turn was killed')
        .with('restart', () => '⛔ **No longer awaiting an answer** — the process restarted and abandoned this turn')
        .with('stop', () => '⛔ **No longer awaiting an answer** — the turn was stopped')
        .exhaustive();
    })
    .exhaustive();
  const answer = decision.kind === 'answered' ? [`> ${decision.answerText}`] : [];
  return [`${line}: \`${input.actionName}\``, input.question, ...answer].join('\n\n');
}

/**
 * One button per offered answer, each carrying its own label, and always the one that opens the
 * free-text dialog: §3.7a offers options beside free text, never instead of it. The renderer is
 * handed the signing function and never the key; each button's context signs its own answer (§6.4).
 */
export function renderAskActions(input: {
  answerUrl: string;
  askId: string;
  options?: readonly string[];
  sign: (parts: readonly string[]) => string;
}): MessageAttachment[] {
  const options = (input.options ?? []).map((answerText, index) => ({
    id: `option${index}`,
    integration: {
      context: { answerText, askId: input.askId, signature: input.sign(['ask', input.askId, answerText]) },
      url: input.answerUrl
    },
    name: answerText
  }));
  return [
    {
      actions: [
        ...options,
        {
          id: FREE_TEXT_ACTION_ID,
          integration: {
            context: { askId: input.askId, signature: input.sign(['ask', input.askId]) },
            url: input.answerUrl
          },
          name: FREE_TEXT_ACTION_NAME,
          style: 'primary' as const
        }
      ],
      fallback: 'question answer buttons'
    }
  ];
}

export function renderAskRefusal(failure: DecisionFailure): string {
  return match(failure)
    .with({ kind: 'already-resolved' }, () => 'This question has already been answered.')
    .with({ kind: 'approver-not-human' }, () => 'Only a human can answer this question.')
    .with({ kind: 'approver-not-present' }, () => 'Only someone present in this channel can answer this question.')
    .with({ kind: 'dialog-undeliverable' }, () => 'The answer dialog could not be opened. Try again.')
    .with({ kind: 'not-found' }, () => 'This question no longer exists.')
    .exhaustive();
}
