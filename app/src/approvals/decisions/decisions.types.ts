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
