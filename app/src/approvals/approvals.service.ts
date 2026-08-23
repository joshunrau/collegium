import { randomUUID } from 'node:crypto';

import { removeTrailingSlash, Result } from '@collegium/core/utils';
import { Injectable } from '@nestjs/common';

import { TransportRegistry } from '@/chat/transports/transport.registry.ts';
import { EnvService } from '@/config/env/env.service.ts';
import { LoggingService } from '@/logging/logging.service.ts';
import { InjectModel } from '@/prisma/prisma.decorators.ts';
import type { ApprovalStatus, Model, ModelRow } from '@/prisma/prisma.types.ts';

import { renderApprovalActions, renderApprovalPrompt, renderResolvedPrompt } from './approvals.renderer.ts';
import { renderApprovalActionName } from './approvals.utils.ts';
import { PendingRegistry } from './decisions/pending.registry.ts';

import type {
  ApprovalCancellationReason,
  ApprovalDecision,
  ApprovalFailure,
  ApprovalFailureDecision,
  ApprovalFailureRequest,
  ApprovalRequest,
  DecisionInput
} from './approvals.types.ts';

type ApprovalRow = ModelRow<'Approval'> & { turn: { agentUsername: string; channelId: string } };

function toStatus(decision: ApprovalDecision): Exclude<ApprovalStatus, 'pending'> {
  switch (decision.kind) {
    case 'approved':
      return 'approved';
    case 'cancelled':
      return 'invalidated';
    case 'denied':
      return 'denied';
    case 'denied-with-reason':
      return 'denied_with_reason';
  }
}

@Injectable()
export class ApprovalsService {
  private readonly decisionsUrl: string;

  constructor(
    @InjectModel('Approval') private readonly approvals: Model<'Approval'>,
    envService: EnvService,
    private readonly loggingService: LoggingService,
    private readonly pendingRegistry: PendingRegistry,
    private readonly transportRegistry: TransportRegistry
  ) {
    this.decisionsUrl = `${removeTrailingSlash(envService.get('APP_PUBLIC_URL'))}/decisions`;
  }

  /** §7.5 — the sweep both channel-scoped commands run, so a parked turn is reachable at all */
  async cancelPendingIn(channelId: string, reason: 'kill' | 'stop'): Promise<number> {
    return this.cancelWhere({ turn: { channelId } }, reason);
  }

  /** one button click, checked against channel presence before it may resolve anything (§3.7) */
  async decide(input: DecisionInput): Promise<Result<void, ApprovalFailureDecision>> {
    const loaded = await this.loadForDecision(input.approvalId, input.byUserId);
    if (!loaded.success) {
      return loaded;
    }
    const { approverUsername, row } = loaded.value;
    if (input.action === 'approve') {
      return this.resolveRow(row, { byUsername: approverUsername, kind: 'approved' });
    }
    if (input.action === 'deny') {
      return this.resolveRow(row, { byUsername: approverUsername, kind: 'denied' });
    }
    return this.openReasonDialog(row, { ...input, byUsername: approverUsername });
  }

  /** the deny-with-reason dialog coming back (§5.4) */
  async decideWithReason(input: {
    approvalId: string;
    byUserId: string;
    byUsername: string;
    reason: string;
  }): Promise<Result<void, ApprovalFailureDecision>> {
    const loaded = await this.loadForDecision(input.approvalId, input.byUserId);
    if (!loaded.success) {
      return loaded;
    }
    return this.resolveRow(loaded.value.row, {
      byUsername: loaded.value.approverUsername,
      kind: 'denied-with-reason',
      reason: input.reason
    });
  }

  /** §7.3 and §7.4 — a stale prompt must not be clickable into confusion or action */
  async invalidateAll(reason: 'halt' | 'restart'): Promise<number> {
    return this.cancelWhere({}, reason);
  }

  /**
   * Posts the prompt under the agent's own account and blocks — for days if necessary (§3.7). The
   * resolver is registered before the row exists: a cancellation sweep that finds the row must
   * always find a resolver to fire, or the turn it belongs to would park forever.
   */
  async request(input: ApprovalRequest): Promise<Result<ApprovalDecision, ApprovalFailureRequest>> {
    const refusal = await this.refuseIfOverLimit(input);
    if (refusal) {
      return Result.err(refusal);
    }
    const approvalId = randomUUID();
    const pendingDecision = new Promise<ApprovalDecision>((resolve) => {
      this.pendingRegistry.register({ approvalId, channelId: input.channelId, resolve });
    });
    await this.approvals.create({
      data: {
        args: input.args,
        id: approvalId,
        payloadText: input.payloadText,
        status: 'pending',
        toolName: input.toolName,
        toolNamespace: input.toolNamespace,
        turnId: input.turnId
      }
    });
    const posted = await this.postPrompt(input, approvalId);
    if (!posted.success) {
      // the rollback is "un-create", not "resolve": there is no prompt to rewrite and no decision to fire
      this.pendingRegistry.take(approvalId);
      await this.claimPending(approvalId, 'invalidated');
      return posted;
    }
    await this.approvals.updateMany({ data: { promptPostId: posted.value.postId }, where: { id: approvalId } });
    await this.rewriteIfResolvedMeanwhile(input, approvalId, posted.value.postId, pendingDecision);
    await input.appendEvent({
      approvalId,
      kind: 'approval_requested',
      payloadText: input.payloadText,
      toolName: input.toolNamespace === null ? input.toolName : [input.toolNamespace, input.toolName]
    });
    const decision = await pendingDecision;
    if (decision.kind !== 'cancelled') {
      await input.appendEvent({
        approvalId,
        byUsername: decision.byUsername,
        decision:
          decision.kind === 'approved' ? 'approved' : decision.kind === 'denied' ? 'denied' : 'denied_with_reason',
        kind: 'approval_decided',
        ...(decision.kind === 'denied-with-reason' && { reason: decision.reason })
      });
    }
    return Result.ok(decision);
  }

  async resolve(approvalId: string, decision: ApprovalDecision): Promise<Result<void, ApprovalFailureDecision>> {
    const row = await this.approvals.findUnique({ include: { turn: true }, where: { id: approvalId } });
    if (!row) {
      return Result.err({ approvalId, kind: 'not-found' });
    }
    return this.resolveRow(row, decision);
  }

  /** the atomic pending→terminal transition: exactly one resolver wins a given row (§3.7) */
  private async applyResolution(row: ApprovalRow, decision: ApprovalDecision): Promise<boolean> {
    const claimed = await this.claimPending(row.id, toStatus(decision), {
      ...(decision.kind !== 'cancelled' && { decidedByUsername: decision.byUsername }),
      ...((decision.kind === 'cancelled' || decision.kind === 'denied-with-reason') && { reason: decision.reason })
    });
    if (!claimed) {
      return false;
    }
    await this.rewritePrompt(
      row.turn.agentUsername,
      row.promptPostId,
      renderResolvedPrompt(this.toPromptInput(row), decision)
    );
    this.pendingRegistry.take(row.id)?.resolve(decision);
    return true;
  }

  private async cancelWhere(
    where: { turn?: { channelId: string } },
    reason: ApprovalCancellationReason
  ): Promise<number> {
    const pending = await this.findPending(where);
    let cancelled = 0;
    for (const row of pending) {
      if (await this.applyResolution(row, { kind: 'cancelled', reason })) {
        cancelled += 1;
      }
    }
    return cancelled;
  }

  /** the ONLY pending→terminal write: whoever wins this update owns the row's ending */
  private async claimPending(
    approvalId: string,
    status: Exclude<ApprovalStatus, 'pending'>,
    fields: { decidedByUsername?: string; reason?: string } = {}
  ): Promise<boolean> {
    const claimed = await this.approvals.updateMany({
      data: { decidedAt: new Date(), status, ...fields },
      where: { id: approvalId, status: 'pending' }
    });
    return claimed.count > 0;
  }

  private async findPending(where: { turn?: { channelId: string } }): Promise<ApprovalRow[]> {
    return this.approvals.findMany({ include: { turn: true }, where: { ...where, status: 'pending' } });
  }

  private async loadForDecision(
    approvalId: string,
    byUserId: string
  ): Promise<Result<{ approverUsername: string; row: ApprovalRow }, ApprovalFailureDecision>> {
    const row = await this.approvals.findUnique({ include: { turn: true }, where: { id: approvalId } });
    if (!row) {
      return Result.err({ approvalId, kind: 'not-found' });
    }
    const approver = await this.resolveApprover(row, byUserId);
    if (!approver.success) {
      return approver;
    }
    return Result.ok({ approverUsername: approver.value, row });
  }

  private async openReasonDialog(
    row: ApprovalRow,
    input: DecisionInput
  ): Promise<Result<void, ApprovalFailureDecision>> {
    if (input.triggerId === undefined) {
      return Result.err({ kind: 'dialog-undeliverable', message: 'the click carried no trigger id' });
    }
    const opened = await this.transportRegistry.get(row.turn.agentUsername).openDialog({
      callbackId: row.id,
      elements: [{ displayName: 'Reason', name: 'reason', type: 'textarea' }],
      // the submission carries no username, so the decider's identity rides the dialog state
      state: input.byUsername,
      submitLabel: 'Deny',
      title: `Deny ${renderApprovalActionName(row.toolNamespace, row.toolName)} with a reason`,
      triggerId: input.triggerId,
      url: `${this.decisionsUrl}/reason`
    });
    if (!opened.success) {
      return Result.err({ kind: 'dialog-undeliverable', message: opened.error.message });
    }
    return Result.ok();
  }

  private async postPrompt(
    input: ApprovalRequest,
    approvalId: string
  ): Promise<Result<{ postId: string }, ApprovalFailure.PromptUndeliverable>> {
    const prompt = renderApprovalPrompt(
      this.toPromptInput(input),
      input.payloadPresentation,
      await this.readPostLimit(input)
    );
    const sent = await this.transportRegistry.get(input.agentUsername).send({
      attachments: renderApprovalActions({ approvalId, decisionsUrl: this.decisionsUrl }),
      channelId: input.channelId,
      files: prompt.files,
      text: prompt.text
    });
    if (!sent.success) {
      return Result.err({ kind: 'prompt-undeliverable', message: sent.error.message });
    }
    return Result.ok({ postId: sent.value.postId });
  }

  /** unreadable is not a reason to attach a payload that would have fitted; the post fails loudly if not */
  private async readPostLimit(input: ApprovalRequest): Promise<number | undefined> {
    const limit = await this.transportRegistry.get(input.agentUsername).maxPostSizeChars();
    if (!limit.success) {
      this.loggingService.warn(
        `could not read MaxPostSize to bound a ${renderApprovalActionName(input.toolNamespace, input.toolName)} approval: ${limit.error.message}`
      );
      return undefined;
    }
    return limit.value;
  }

  /**
   * §6.2 — a verbatim payload (a shell command) that would not fit in a post is refused here, before
   * any prompt is posted, rather than truncated or attached: shell commands are presented inline and
   * in full, and one too long to present is itself the signal. A 'collapse' payload is never refused
   * — it travels as an attachment instead. If the substrate's limit cannot be read we do not block a
   * legitimate small command; the post itself fails loudly if it is genuinely too large.
   */
  private async refuseIfOverLimit(input: ApprovalRequest): Promise<ApprovalFailure.PayloadTooLarge | undefined> {
    if (input.payloadPresentation !== 'verbatim') {
      return undefined;
    }
    const limit = await this.readPostLimit(input);
    if (limit === undefined) {
      return undefined;
    }
    const { text } = renderApprovalPrompt(this.toPromptInput(input), input.payloadPresentation, limit);
    if (text.length <= limit) {
      return undefined;
    }
    return { actualChars: text.length, kind: 'payload-too-large', limitChars: limit };
  }

  /**
   * §3.7 — authority is "any human present in the channel", so both halves are checked against the
   * user id. The username is read back from that id rather than taken from the request body, which
   * anything reaching the port could otherwise choose for itself.
   */
  private async resolveApprover(row: ApprovalRow, userId: string): Promise<Result<string, ApprovalFailureDecision>> {
    const transport = this.transportRegistry.get(row.turn.agentUsername);
    const described = await transport.describeUser(userId);
    if (!described.success) {
      return Result.err({ kind: 'approver-not-present', username: userId });
    }
    const membership = await transport.isChannelMember(row.turn.channelId, userId);
    if (!membership.success || !membership.value) {
      return Result.err({ kind: 'approver-not-present', username: described.value.username });
    }
    if (described.value.isBot) {
      return Result.err({ kind: 'approver-not-human', username: described.value.username });
    }
    return Result.ok(described.value.username);
  }

  private async resolveRow(
    row: ApprovalRow,
    decision: ApprovalDecision
  ): Promise<Result<void, ApprovalFailureDecision>> {
    if (!(await this.applyResolution(row, decision))) {
      return Result.err({ approvalId: row.id, kind: 'already-resolved' });
    }
    return Result.ok();
  }

  /** a resolution that raced the prompt's own posting found no post id — rewrite it now (§3.7) */
  private async rewriteIfResolvedMeanwhile(
    input: ApprovalRequest,
    approvalId: string,
    promptPostId: string,
    pendingDecision: Promise<ApprovalDecision>
  ): Promise<void> {
    const current = await this.approvals.findFirst({ select: { status: true }, where: { id: approvalId } });
    if (current?.status === 'pending') {
      return;
    }
    const decision = await pendingDecision;
    await this.rewritePrompt(
      input.agentUsername,
      promptPostId,
      renderResolvedPrompt(this.toPromptInput(input), decision)
    );
  }

  private async rewritePrompt(agentUsername: string, promptPostId: null | string, text: string): Promise<void> {
    if (promptPostId === null) {
      return;
    }
    const updated = await this.transportRegistry.get(agentUsername).updatePost(promptPostId, { attachments: [], text });
    if (!updated.success) {
      this.loggingService.error(
        new Error(`failed to rewrite approval prompt ${promptPostId}: ${updated.error.message}`)
      );
    }
  }

  private toPromptInput(source: { payloadText: string; toolName: string; toolNamespace: null | string }) {
    return {
      actionName: renderApprovalActionName(source.toolNamespace, source.toolName),
      payloadText: source.payloadText
    };
  }
}
