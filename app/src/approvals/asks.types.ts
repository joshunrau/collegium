import type { TurnEventInput } from '@/turns/turns.types.ts';

import type { PendingCancellationReason, PendingDecisionFailure } from './decisions/decisions.types.ts';

/**
 * §3.7a — an ask ends in a human's words or not at all: there is no action to refuse, so there is
 * no denial. A cancellation is how /stop, /kill, a halt, and a restart reach a parked turn (§7.5).
 */
export type AskDecision =
  | { answerText: string; byUsername: string; kind: 'answered' }
  | { kind: 'cancelled'; reason: PendingCancellationReason };

/** raised while putting the question, before any answer endpoint exists */
export type AskFailureRequest = PendingDecisionFailure.PromptUndeliverable;

/** one option button, or the free-text dialog coming back; either way the answer is the human's words */
export type AnswerInput = {
  readonly answerText: string;
  readonly askId: string;
  readonly byUserId: string;
};

export type AskRequest = {
  readonly agentUsername: string;
  /**
   * The turn's own event appender, passed through the call rather than imported: asks sit below
   * turns in the dependency graph, and the trace belongs to the turn that is blocked here.
   */
  readonly appendEvent: (event: TurnEventInput) => Promise<void>;
  /** the tool call being answered; an ask is always one, so its answer always replays as that call's result */
  readonly callId: string;
  readonly channelId: string;
  /** §3.7a — the turn's line above the question, worded by the turn that is blocked here */
  readonly contextText?: string;
  /** the short answers offered as buttons beside free text; at most six, per the tool's own schema */
  readonly options?: readonly string[];
  readonly question: string;
  readonly toolName: string;
  readonly toolNamespace: string;
  readonly turnId: string;
};
