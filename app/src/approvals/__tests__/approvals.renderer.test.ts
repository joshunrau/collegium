import { describe, expect, it } from 'vitest';

import {
  renderApprovalActions,
  renderApprovalPrompt,
  renderDecisionRefusal,
  renderResolvedPrompt
} from '../approvals.renderer.ts';

import type { DecisionFailure, PendingCancellationReason } from '../decisions/decisions.types.ts';

const INPUT = { actionName: 'workspace::write', payloadText: 'write notes.md with 12 words' };

describe('renderApprovalPrompt', () => {
  it('should show the whole payload inline when a post can carry it (§6.2)', () => {
    expect(renderApprovalPrompt(INPUT, 'collapse', 16_383)).toStrictEqual({
      files: [],
      text: '🔐 **Approval required: `workspace::write`**\n\nwrite notes.md with 12 words'
    });
  });

  // §6.2/§3.7 — a bounded prefix inline and the complete payload attached, so the approver reads
  // the exact bytes rather than a rendering of them
  it('should attach a collapse payload the substrate cannot carry (§6.2)', () => {
    const payloadText = 'x'.repeat(20_000);
    const rendered = renderApprovalPrompt({ ...INPUT, payloadText }, 'collapse', 16_383);
    expect(rendered.files).toStrictEqual([{ content: payloadText, filename: 'payload.md' }]);
    expect(rendered.text).toContain('all 20000 characters are attached as payload.md');
    expect(rendered.text.length).toBeLessThan(16_383);
  });

  it('should never attach a verbatim payload, so a shell command is shown in full or not at all (§6.2)', () => {
    const payloadText = 'x'.repeat(20_000);
    expect(renderApprovalPrompt({ actionName: 'shell::run', payloadText }, 'verbatim', 16_383)).toStrictEqual({
      files: [],
      text: `🔐 **Approval required: \`shell::run\`**\n\n${payloadText}`
    });
  });

  it('should place the context line between the header and the payload (§3.7)', () => {
    const contextText = 'Action 7 of 25 · raised by a trigger';
    expect(renderApprovalPrompt({ ...INPUT, contextText }, 'collapse', 16_383).text).toBe(
      `🔐 **Approval required: \`workspace::write\`**\n${contextText}\n\nwrite notes.md with 12 words`
    );
  });

  it('should keep the context line on a prompt whose payload had to be attached (§3.7)', () => {
    const rendered = renderApprovalPrompt(
      { ...INPUT, contextText: 'Action 7 of 25 · raised by a trigger', payloadText: 'x'.repeat(20_000) },
      'collapse',
      16_383
    );
    expect(rendered.text).toContain('Action 7 of 25 · raised by a trigger');
  });

  it('should stay inline when the substrate limit cannot be read', () => {
    const payloadText = 'x'.repeat(20_000);
    expect(renderApprovalPrompt({ ...INPUT, payloadText }, 'collapse', undefined).files).toStrictEqual([]);
  });
});

describe('renderResolvedPrompt', () => {
  it('should replace the heading with the decision (§3.7)', () => {
    expect(renderResolvedPrompt(INPUT, { byUsername: 'casey', kind: 'approved' })).toBe(
      '✅ **Approved** by @casey: `workspace::write`\n\nwrite notes.md with 12 words'
    );
  });

  it('should distinguish a bare denial from a denial carrying a reason (§5.4)', () => {
    expect(renderResolvedPrompt(INPUT, { byUsername: 'casey', kind: 'denied' })).toBe(
      '🛑 **Denied** by @casey: `workspace::write`\n\nwrite notes.md with 12 words'
    );
    expect(renderResolvedPrompt(INPUT, { byUsername: 'casey', kind: 'denied-with-reason', reason: 'wrong file' })).toBe(
      '↩️ **Denied with reason** by @casey: wrong file: `workspace::write`\n\nwrite notes.md with 12 words'
    );
  });

  it('should say which cancellation reached the prompt, never calling it a denial (§7.5)', () => {
    const lines: readonly [PendingCancellationReason, string][] = [
      ['halt', '⛔ **No longer awaiting a decision** — a global halt interrupted this turn'],
      ['kill', '⛔ **No longer awaiting a decision** — the turn was killed'],
      ['restart', '⛔ **No longer awaiting a decision** — the process restarted and abandoned this turn'],
      ['stop', '⛔ **No longer awaiting a decision** — the turn was stopped']
    ];
    for (const [reason, line] of lines) {
      expect(renderResolvedPrompt(INPUT, { kind: 'cancelled', reason })).toBe(
        `${line}: \`workspace::write\`\n\nwrite notes.md with 12 words`
      );
    }
  });
});

describe('renderApprovalActions', () => {
  it('should give every button a plain alphanumeric id and carry the action in its context (§3.7)', () => {
    const [attachment] = renderApprovalActions({
      approvalId: 'approval-1',
      decisionsUrl: 'http://host/decisions',
      sign: (parts) => parts.join('|')
    });
    expect(attachment?.actions?.map((action) => [action.id, action.integration.context?.action])).toStrictEqual([
      ['approve', 'approve'],
      ['deny', 'deny'],
      ['reason', 'deny-with-reason']
    ]);
    expect(attachment?.actions?.[0]?.integration).toStrictEqual({
      context: { action: 'approve', approvalId: 'approval-1', signature: 'decision|approval-1|approve' },
      url: 'http://host/decisions'
    });
  });
});

describe('renderDecisionRefusal', () => {
  it('should explain every way a decision can be refused', () => {
    const refusals: readonly [DecisionFailure, string][] = [
      [{ kind: 'already-resolved', pendingId: 'approval-1' }, 'This approval has already been decided.'],
      [{ kind: 'approver-not-human', username: 'mira' }, 'Only a human can decide this approval.'],
      [
        { kind: 'approver-not-present', username: 'outsider' },
        'Only someone present in this channel can decide this approval.'
      ],
      [{ kind: 'dialog-undeliverable', message: 'no trigger id' }, 'The reason dialog could not be opened. Try again.'],
      [{ kind: 'not-found', pendingId: 'approval-1' }, 'This approval no longer exists.']
    ];
    for (const [failure, message] of refusals) {
      expect(renderDecisionRefusal(failure)).toBe(message);
    }
  });
});
