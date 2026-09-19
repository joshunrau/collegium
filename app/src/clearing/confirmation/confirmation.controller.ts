import { Body, Controller, HttpCode, Post, UnauthorizedException } from '@nestjs/common';

import { CallbackSigner } from '@/chat/callback-auth/callback-signer.service.ts';
import { LoggingService } from '@/logging/logging.service.ts';

import { renderRefusal } from '../clearing.renderer.ts';
import { ClearingService } from '../clearing.service.ts';
import { $ClearingDialogSubmissionBody } from './confirmation.schemas.ts';
import { toSignedParts } from './confirmation.utils.ts';

/**
 * §6.4 — Mattermost assembles the submission from the dialog's state and can set no header of its
 * own, so the state carries a signature over the request it describes, verified here before the
 * service is reached. A mismatch is logged rather than answered: nobody genuine sent it.
 */
@Controller('clearing')
export class ConfirmationController {
  constructor(
    private readonly callbackSigner: CallbackSigner,
    private readonly clearingService: ClearingService,
    private readonly loggingService: LoggingService
  ) {}

  // Mattermost treats anything but 200 as a dialog integration error
  @HttpCode(200)
  @Post('confirm')
  async confirm(@Body() body: unknown): Promise<{ error?: string }> {
    const submission = $ClearingDialogSubmissionBody.parse(body);
    if (submission.cancelled) {
      return {};
    }
    const { signature, ...state } = submission.state;
    if (!this.callbackSigner.verify(toSignedParts(state), signature)) {
      this.loggingService.warn(`refused a clear confirmation for ${state.channelId}: its signature did not verify`);
      throw new UnauthorizedException();
    }
    const outcome = await this.clearingService.confirm(state);
    return outcome.success ? {} : { error: renderRefusal(outcome.error) };
  }
}
