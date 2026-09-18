import { Body, Controller, HttpCode, Post, UnauthorizedException } from '@nestjs/common';

import { CallbackSigner } from '@/chat/callback-auth/callback-signer.service.ts';
import { LoggingService } from '@/logging/logging.service.ts';

import { renderDecisionRefusal } from '../approvals.renderer.ts';
import { $MattermostActionBody, $MattermostDialogSubmissionBody } from '../approvals.schemas.ts';
import { ApprovalsService } from '../approvals.service.ts';
import { renderAskRefusal } from '../asks.renderer.ts';
import { $MattermostAskActionBody, $MattermostAskAnswerDialogBody } from '../asks.schemas.ts';
import { AsksService } from '../asks.service.ts';

/**
 * §6.4 — Mattermost assembles these requests from a button's context and a dialog's state and can
 * set no header of its own, so each carries a signature over its one approval (§3.7) or question
 * (§3.7a), verified here before the service is reached. A mismatch is logged rather than answered:
 * it means the request did not come from a genuine callback for that row, so there is nobody to
 * answer.
 */
@Controller('decisions')
export class DecisionsController {
  constructor(
    private readonly approvalsService: ApprovalsService,
    private readonly asksService: AsksService,
    private readonly callbackSigner: CallbackSigner,
    private readonly loggingService: LoggingService
  ) {}

  // Mattermost treats anything but 200 as an action integration error
  @HttpCode(200)
  @Post('ask')
  async answer(@Body() body: unknown): Promise<{ ephemeral_text?: string }> {
    const action = $MattermostAskActionBody.parse(body);
    const { answerText, askId, signature } = action.context;
    this.assertSigned(answerText === undefined ? ['ask', askId] : ['ask', askId, answerText], signature, askId);
    const outcome =
      answerText === undefined
        ? await this.asksService.openAnswerDialog({ askId, byUserId: action.userId, triggerId: action.triggerId })
        : await this.asksService.answer({ answerText, askId, byUserId: action.userId });
    return outcome.success ? {} : { ephemeral_text: renderAskRefusal(outcome.error) };
  }

  @HttpCode(200)
  @Post()
  async decide(@Body() body: unknown): Promise<{ ephemeral_text?: string }> {
    const action = $MattermostActionBody.parse(body);
    this.assertSigned(
      ['decision', action.context.approvalId, action.context.action],
      action.context.signature,
      action.context.approvalId
    );
    const outcome = await this.approvalsService.decide({
      action: action.context.action,
      approvalId: action.context.approvalId,
      byUserId: action.userId,
      byUsername: action.userName,
      triggerId: action.triggerId
    });
    return outcome.success ? {} : { ephemeral_text: renderDecisionRefusal(outcome.error) };
  }

  @HttpCode(200)
  @Post('ask/answer')
  async submitAnswer(@Body() body: unknown): Promise<{ error?: string }> {
    const submission = $MattermostAskAnswerDialogBody.parse(body);
    if (submission.cancelled) {
      return {};
    }
    this.assertSigned(
      ['ask-answer', submission.callbackId, submission.state.byUsername],
      submission.state.signature,
      submission.callbackId
    );
    const outcome = await this.asksService.answer({
      answerText: submission.submission.answer,
      askId: submission.callbackId,
      byUserId: submission.userId
    });
    return outcome.success ? {} : { error: renderAskRefusal(outcome.error) };
  }

  @HttpCode(200)
  @Post('reason')
  async submitReason(@Body() body: unknown): Promise<{ error?: string }> {
    const submission = $MattermostDialogSubmissionBody.parse(body);
    if (submission.cancelled) {
      return {};
    }
    this.assertSigned(
      ['reason', submission.callbackId, submission.state.byUsername],
      submission.state.signature,
      submission.callbackId
    );
    const outcome = await this.approvalsService.decideWithReason({
      approvalId: submission.callbackId,
      byUserId: submission.userId,
      byUsername: submission.state.byUsername,
      reason: submission.submission.reason
    });
    return outcome.success ? {} : { error: renderDecisionRefusal(outcome.error) };
  }

  private assertSigned(parts: readonly string[], signature: string, pendingId: string): void {
    if (!this.callbackSigner.verify(parts, signature)) {
      this.loggingService.warn(`refused a decision callback for ${pendingId}: its signature did not verify`);
      throw new UnauthorizedException();
    }
  }
}
