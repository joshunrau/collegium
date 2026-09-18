import type { ApprovalPayloadPresentation } from '@collegium/core/approvals';

import type { TurnEventInput } from '@/turns/turns.types.ts';

import type { PendingCancellationReason, PendingDecisionFailure } from './decisions/decisions.types.ts';

/**
 * §5.4 — a bare denial terminates the turn; a denial with reason continues it under the same
 * budget. A cancellation is how /stop, /kill, a halt, and a restart reach a parked turn (§7.5):
 * not a denial, because no human refused the action.
 */
export type ApprovalDecision =
  | { byUsername: string; kind: 'approved' }
  | { byUsername: string; kind: 'denied' }
  | { byUsername: string; kind: 'denied-with-reason'; reason: string }
  | { kind: 'cancelled'; reason: PendingCancellationReason };

/** §6.2 — a verbatim payload (a shell command) too long to present in a post is refused, not truncated */
export type ApprovalPayloadTooLarge = {
  actualChars: number;
  kind: 'payload-too-large';
  limitChars: number;
};

/** raised while asking for consent, before any decision endpoint exists */
export type ApprovalFailureRequest = ApprovalPayloadTooLarge | PendingDecisionFailure.PromptUndeliverable;

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
  /** the tool call being gated, so its decision can be replayed as that call's result; absent for a framework action */
  readonly callId?: string;
  readonly channelId: string;
  /** §3.7 — the turn's line above the payload, worded by the turn that is blocked here; absent for a framework action */
  readonly contextText?: string;
  /** §6.2 — how the payload is shown, and whether an over-long one is refused rather than collapsed */
  readonly payloadPresentation: ApprovalPayloadPresentation;
  readonly payloadText: string;
  readonly toolName: string;
  /** the tool's namespace, or null for a framework action that is not a tool (the budget extension) */
  readonly toolNamespace: null | string;
  readonly turnId: string;
};
