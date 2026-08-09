import type { ApprovalPayloadPresentation } from '@collegium/core/approvals';

import type { TurnEventInput } from '@/turns/turns.types.ts';

/** how a pending approval dies without a human decision: §7.5 commands, the §7.4 halt, a §7.3 restart */
export type ApprovalCancellationReason = 'halt' | 'kill' | 'restart' | 'stop';

/**
 * §5.4 — a bare denial terminates the turn; a denial with reason continues it under the same
 * budget. A cancellation is how /stop, /kill, a halt, and a restart reach a parked turn (§7.5):
 * not a denial, because no human refused the action.
 */
export type ApprovalDecision =
  | { byUsername: string; kind: 'approved' }
  | { byUsername: string; kind: 'denied' }
  | { byUsername: string; kind: 'denied-with-reason'; reason: string }
  | { kind: 'cancelled'; reason: ApprovalCancellationReason };

export declare namespace ApprovalFailure {
  /** a second decision on a resolved approval — refused, never re-applied (§3.7) */
  type AlreadyResolved = {
    approvalId: string;
    kind: 'already-resolved';
  };
  /** §3.7 — presence confers authority: a decision from outside the channel is refused */
  type ApproverNotPresent = {
    kind: 'approver-not-present';
    username: string;
  };
  /** §3.7 says any *human* present in the channel; presence alone is not authority */
  type ApproverNotHuman = {
    kind: 'approver-not-human';
    username: string;
  };
  /** the deny-with-reason dialog could not be opened for the clicking human */
  type DialogUndeliverable = {
    kind: 'dialog-undeliverable';
    message: string;
  };
  type NotFound = {
    approvalId: string;
    kind: 'not-found';
  };
  /** §6.2 — a verbatim payload (a shell command) too long to present in a post is refused, not truncated */
  type PayloadTooLarge = {
    actualChars: number;
    kind: 'payload-too-large';
    limitChars: number;
  };
  /** the prompt could not be posted, so consent can never arrive */
  type PromptUndeliverable = {
    kind: 'prompt-undeliverable';
    message: string;
  };
}

/** raised by a decision arriving at the endpoint — a request-time failure can never appear here */
export type ApprovalFailureDecision =
  | ApprovalFailure.AlreadyResolved
  | ApprovalFailure.ApproverNotHuman
  | ApprovalFailure.ApproverNotPresent
  | ApprovalFailure.DialogUndeliverable
  | ApprovalFailure.NotFound;

/** raised while asking for consent, before any decision endpoint exists */
export type ApprovalFailureRequest = ApprovalFailure.PayloadTooLarge | ApprovalFailure.PromptUndeliverable;

/** one button click on the prompt, bound by the controller and decided one layer in */
export type DecisionInput = {
  readonly action: 'approve' | 'deny' | 'deny-with-reason';
  readonly approvalId: string;
  readonly byUserId: string;
  readonly byUsername: string;
  readonly triggerId?: string;
};

export type ApprovalRequest = {
  readonly agentUsername: string;
  /**
   * The turn's own event appender, passed through the call rather than imported: approvals sit
   * below turns in the dependency graph, and the trace belongs to the turn that is blocked here.
   */
  readonly appendEvent: (event: TurnEventInput) => Promise<void>;
  readonly args: unknown;
  readonly channelId: string;
  /** §6.2 — how the payload is shown, and whether an over-long one is refused rather than collapsed */
  readonly payloadPresentation: ApprovalPayloadPresentation;
  readonly payloadText: string;
  readonly toolName: string;
  readonly turnId: string;
};
