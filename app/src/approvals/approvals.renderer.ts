import type { ApprovalPayloadPresentation } from '@collegium/core/approvals';
import { match } from 'ts-pattern';

import type { MessageAttachment, PostFile } from '@/chat/chat.types.ts';

import type { ApprovalDecision, ApprovalFailureDecision } from './approvals.types.ts';

/** how much of an attached payload still shows inline, so the post says what it is about */
const INLINE_PREFIX_CHARS = 600;

const ATTACHED_PAYLOAD_FILENAME = 'payload.md';

function renderHeader(toolName: string): string {
  return `🔐 **Approval required: \`${toolName}\`**`;
}

/** the resolved post is a historical record; the untruncated payload lives in the trace (§8.3) */
function capPayload(payloadText: string): string {
  if (payloadText.length <= INLINE_PREFIX_CHARS) {
    return payloadText;
  }
  return `${payloadText.slice(0, INLINE_PREFIX_CHARS)}\n…${payloadText.length - INLINE_PREFIX_CHARS} further characters`;
}

/** the prompt as it goes on the wire: the post, and the payload it could not carry inline */
export type RenderedPrompt = {
  readonly files: readonly PostFile[];
  readonly text: string;
};

export type PromptInput = {
  readonly payloadText: string;
  readonly toolName: string;
};

/**
 * §6.2 — the approver sees the exact bytes, not a rendering of them. Inline while they fit the
 * substrate's own limit, and otherwise a bounded prefix inline with the whole payload attached: the
 * same answer §4.2 gives a trigger body and §8.3 gives a trace, in the third place it arises.
 *
 * A `verbatim` payload — a shell command — is never attached. One too long to present is refused
 * before it reaches here, because a command that will not fit in a post is itself the signal.
 */
export function renderApprovalPrompt(
  input: PromptInput,
  presentation: ApprovalPayloadPresentation,
  maxPostSizeChars: number | undefined
): RenderedPrompt {
  const inline = `${renderHeader(input.toolName)}\n\n${input.payloadText}`;
  if (presentation === 'verbatim' || maxPostSizeChars === undefined || inline.length <= maxPostSizeChars) {
    return { files: [], text: inline };
  }
  return {
    files: [{ content: input.payloadText, filename: ATTACHED_PAYLOAD_FILENAME }],
    text: [
      renderHeader(input.toolName),
      '',
      capPayload(input.payloadText),
      '',
      `The payload is too large to post, so all ${input.payloadText.length} characters are attached as ${ATTACHED_PAYLOAD_FILENAME}.`
    ].join('\n')
  };
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
  // even a verbatim payload may be capped here without hiding anything from the approver (§6.2)
  return `🔐 ~~Approval required: \`${input.toolName}\`~~\n\n${line}\n\n${capPayload(input.payloadText)}`;
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
