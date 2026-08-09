import type { ApprovalPayloadPresentation } from '@collegium/core/approvals';
import { match } from 'ts-pattern';

import type { MessageAttachment } from '@/chat/chat.types.ts';

import type { ApprovalDecision, ApprovalFailureDecision } from './approvals.types.ts';

/** §6.2 — a long 'collapse' payload goes behind an expandable control; a 'verbatim' one (shell) never would */
const COLLAPSE_THRESHOLD_CHARS = 600;

function renderPayload(payloadText: string, presentation: ApprovalPayloadPresentation): string {
  if (presentation === 'verbatim' || payloadText.length <= COLLAPSE_THRESHOLD_CHARS) {
    return payloadText;
  }
  return `<details><summary>Show the full payload (${payloadText.length} characters)</summary>\n\n${payloadText}\n\n</details>`;
}

export type PromptInput = {
  readonly payloadText: string;
  readonly toolName: string;
};

/** the full payload, not just the intent — a payload nobody can read is a payload nobody is checking (§6.2) */
export function renderApprovalPrompt(input: PromptInput, presentation: ApprovalPayloadPresentation): string {
  return `🔐 **Approval required: \`${input.toolName}\`**\n\n${renderPayload(input.payloadText, presentation)}`;
}

/** once resolved, the prompt is rewritten into a terminal state and its buttons removed (§3.7) */
export function renderResolvedPrompt(input: PromptInput, decision: ApprovalDecision): string {
  const line = match(decision)
    .with({ kind: 'approved' }, ({ byUsername }) => `✅ **Approved** by @${byUsername}`)
    .with({ kind: 'cancelled' }, ({ reason }) =>
      match(reason)
        .with('halt', () => '⛔ **No longer awaiting a decision** — a global halt interrupted this turn')
        .with('kill', () => '⛔ **No longer awaiting a decision** — the turn was killed')
        .with('restart', () => '⛔ **No longer awaiting a decision** — the process restarted and abandoned this turn')
        .with('stop', () => '⛔ **No longer awaiting a decision** — the turn was stopped')
        .exhaustive()
    )
    .with({ kind: 'denied' }, ({ byUsername }) => `🛑 **Denied** by @${byUsername}`)
    .with(
      { kind: 'denied-with-reason' },
      ({ byUsername, reason }) => `↩️ **Denied with reason** by @${byUsername}: ${reason}`
    )
    .exhaustive();
  // the resolved prompt is a struck-through historical record: the decision already happened with
  // the full payload visible, and the untruncated payload lives in the approval_requested trace, so
  // even a verbatim payload may collapse here without hiding anything from the approver (§6.2)
  return `🔐 ~~Approval required: \`${input.toolName}\`~~\n\n${line}\n\n${renderPayload(input.payloadText, 'collapse')}`;
}

/**
 * The three §3.7 actions, wired to the decision endpoint through the button context. Action ids
 * must be plain alphanumerics — Mattermost's action route rejects hyphenated ids with a 404 — so
 * the id and the context's action name differ for deny-with-reason.
 */
export function renderApprovalActions(input: { approvalId: string; decisionsUrl: string }): MessageAttachment[] {
  const action = (
    id: string,
    decision: 'approve' | 'deny' | 'deny-with-reason',
    name: string,
    style?: 'danger' | 'primary'
  ) => ({
    id,
    integration: { context: { action: decision, approvalId: input.approvalId }, url: input.decisionsUrl },
    name,
    ...(style && { style })
  });
  return [
    {
      actions: [
        action('approve', 'approve', 'Approve', 'primary'),
        action('deny', 'deny', 'Deny', 'danger'),
        action('reason', 'deny-with-reason', 'Deny with reason')
      ],
      fallback: 'approval decision buttons'
    }
  ];
}

export function renderDecisionRefusal(failure: ApprovalFailureDecision): string {
  return match(failure)
    .with({ kind: 'already-resolved' }, () => 'This approval has already been decided.')
    .with({ kind: 'approver-not-human' }, () => 'Only a human can decide this approval.')
    .with({ kind: 'approver-not-present' }, () => 'Only someone present in this channel can decide this approval.')
    .with({ kind: 'dialog-undeliverable' }, () => 'The reason dialog could not be opened. Try again.')
    .with({ kind: 'not-found' }, () => 'This approval no longer exists.')
    .exhaustive();
}
