import { describe, expect, it } from 'vitest';

import {
  renderApprovalActions,
  renderApprovalPrompt,
  renderDecisionRefusal,
  renderResolvedPrompt
} from '../approvals.renderer.ts';

import type { ApprovalCancellationReason, ApprovalFailureDecision } from '../approvals.types.ts';

const INPUT = { payloadText: 'write notes.md with 12 words', toolName: 'write_file' };

describe('renderApprovalPrompt', () => {
  it('should show the whole payload inline when a post can carry it (§6.2)', () => {
    expect(renderApprovalPrompt(INPUT, 'collapse')).toBe(
      '🔐 **Approval required: `write_file`**\n\nwrite notes.md with 12 words'
    );
  });

  it('should move an oversized collapse payload behind an expandable control (§6.2)', () => {
    const payloadText = 'x'.repeat(601);
    expect(renderApprovalPrompt({ ...INPUT, payloadText }, 'collapse')).toBe(
      `🔐 **Approval required: \`write_file\`**\n\n<details><summary>Show the full payload (601 characters)</summary>\n\n${payloadText}\n\n</details>`
    );
  });

  it('should never collapse a verbatim payload, however long, so a shell command is shown in full (§6.2)', () => {
    const payloadText = 'x'.repeat(601);
    expect(renderApprovalPrompt({ payloadText, toolName: 'shell' }, 'verbatim')).toBe(
      `🔐 **Approval required: \`shell\`**\n\n${payloadText}`
    );
  });
});

describe('renderResolvedPrompt', () => {
  it('should strike the heading and name the approver (§3.7)', () => {
    expect(renderResolvedPrompt(INPUT, { byUsername: 'casey', kind: 'approved' })).toBe(
      '🔐 ~~Approval required: `write_file`~~\n\n✅ **Approved** by @casey\n\nwrite notes.md with 12 words'
    );
  });

  it('should distinguish a bare denial from a denial carrying a reason (§5.4)', () => {
    expect(renderResolvedPrompt(INPUT, { byUsername: 'casey', kind: 'denied' })).toContain('🛑 **Denied** by @casey');
    expect(
      renderResolvedPrompt(INPUT, { byUsername: 'casey', kind: 'denied-with-reason', reason: 'wrong file' })
    ).toContain('↩️ **Denied with reason** by @casey: wrong file');
  });

  it('should say which cancellation reached the prompt, never calling it a denial (§7.5)', () => {
    const lines: readonly [ApprovalCancellationReason, string][] = [
      ['halt', '⛔ **No longer awaiting a decision** — a global halt interrupted this turn'],
      ['kill', '⛔ **No longer awaiting a decision** — the turn was killed'],
      ['restart', '⛔ **No longer awaiting a decision** — the process restarted and abandoned this turn'],
      ['stop', '⛔ **No longer awaiting a decision** — the turn was stopped']
    ];
    for (const [reason, line] of lines) {
      expect(renderResolvedPrompt(INPUT, { kind: 'cancelled', reason })).toBe(
        `🔐 ~~Approval required: \`write_file\`~~\n\n${line}\n\nwrite notes.md with 12 words`
      );
    }
  });
});

describe('renderApprovalActions', () => {
  it('should give every button a plain alphanumeric id and carry the action in its context (§3.7)', () => {
    const [attachment] = renderApprovalActions({ approvalId: 'approval-1', decisionsUrl: 'http://host/decisions' });
    expect(attachment?.actions?.map((action) => [action.id, action.integration.context?.action])).toStrictEqual([
      ['approve', 'approve'],
      ['deny', 'deny'],
      ['reason', 'deny-with-reason']
    ]);
    expect(attachment?.actions?.[0]?.integration).toStrictEqual({
      context: { action: 'approve', approvalId: 'approval-1' },
      url: 'http://host/decisions'
    });
  });
});

describe('renderDecisionRefusal', () => {
  it('should explain every way a decision can be refused', () => {
    const refusals: readonly [ApprovalFailureDecision, string][] = [
      [{ approvalId: 'approval-1', kind: 'already-resolved' }, 'This approval has already been decided.'],
      [{ kind: 'approver-not-human', username: 'mira' }, 'Only a human can decide this approval.'],
      [
        { kind: 'approver-not-present', username: 'outsider' },
        'Only someone present in this channel can decide this approval.'
      ],
      [{ kind: 'dialog-undeliverable', message: 'no trigger id' }, 'The reason dialog could not be opened. Try again.'],
      [{ approvalId: 'approval-1', kind: 'not-found' }, 'This approval no longer exists.']
    ];
    for (const [failure, message] of refusals) {
      expect(renderDecisionRefusal(failure)).toBe(message);
    }
  });
});
