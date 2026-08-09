import { Body, Controller, HttpCode, Post } from '@nestjs/common';

import { renderDecisionRefusal } from '../approvals.renderer.ts';
import { $MattermostActionBody, $MattermostDialogSubmissionBody } from '../approvals.schemas.ts';
import { ApprovalsService } from '../approvals.service.ts';

@Controller('decisions')
export class DecisionsController {
  constructor(private readonly approvalsService: ApprovalsService) {}

  // Mattermost treats anything but 200 as an action integration error
  @HttpCode(200)
  @Post()
  async decide(@Body() body: unknown): Promise<{ ephemeral_text?: string }> {
    const action = $MattermostActionBody.parse(body);
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
  @Post('reason')
  async submitReason(@Body() body: unknown): Promise<{ error?: string }> {
    const submission = $MattermostDialogSubmissionBody.parse(body);
    if (submission.cancelled) {
      return {};
    }
    const outcome = await this.approvalsService.decideWithReason({
      approvalId: submission.callbackId,
      byUserId: submission.userId,
      byUsername: submission.state,
      reason: submission.submission.reason
    });
    return outcome.success ? {} : { error: renderDecisionRefusal(outcome.error) };
  }
}
