/** §3.7, §3.7a — the human a decision is attributed to, read back from the substrate and never from the request body */
export type ActingHuman = { readonly username: string };

/** how a parked human decision dies unanswered: §7.5 commands, the §7.4 halt, a §7.3 restart */
export type PendingCancellationReason = 'halt' | 'kill' | 'restart' | 'stop';

/** the vocabulary an approval (§3.7) and an ask (§3.7a) share, because both are one human decision */
export declare namespace PendingDecisionFailure {
  /** a second decision on a resolved row — refused, never re-applied (§3.7) */
  type AlreadyResolved = {
    kind: 'already-resolved';
    pendingId: string;
  };
  /** §3.7 says any *human* present in the channel; presence alone is not authority */
  type ApproverNotHuman = {
    kind: 'approver-not-human';
    username: string;
  };
  /** §3.7 — presence confers authority: a decision from outside the channel is refused */
  type ApproverNotPresent = {
    kind: 'approver-not-present';
    username: string;
  };
  /** the free-text dialog could not be opened for the clicking human */
  type DialogUndeliverable = {
    kind: 'dialog-undeliverable';
    message: string;
  };
  type NotFound = {
    kind: 'not-found';
    pendingId: string;
  };
  /** the prompt could not be posted, so no answer can ever arrive */
  type PromptUndeliverable = {
    kind: 'prompt-undeliverable';
    message: string;
  };
}

/** raised by a decision arriving at the endpoint — a request-time failure can never appear here */
export type DecisionFailure =
  | PendingDecisionFailure.AlreadyResolved
  | PendingDecisionFailure.ApproverNotHuman
  | PendingDecisionFailure.ApproverNotPresent
  | PendingDecisionFailure.DialogUndeliverable
  | PendingDecisionFailure.NotFound;

/** which decisions a listing reads: every one, or those of one agent, one channel or one turn (§8.4) */
export type PendingDecisionScope = {
  readonly agentUsername?: string;
  readonly channelId?: string;
  readonly turnId?: string;
};

/**
 * §8.4 — one decision still parked on a human, as a listing shows it: an approval (§3.7), or a
 * question with its words (§3.7a). The prompt post is where it is made; a null one never posted.
 */
export type PendingDecision = {
  /** in display form, `ns::tool`, or a framework action's name alone */
  readonly actionName: string;
  readonly agentUsername: string;
  readonly channelId: string;
  readonly promptPostId: null | string;
  readonly requestedAt: Date;
  readonly turnId: string;
} & ({ readonly kind: 'approval' } | { readonly kind: 'ask'; readonly question: string });
