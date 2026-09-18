import { Injectable } from '@nestjs/common';

import { ApprovalsService } from '../approvals.service.ts';
import { AsksService } from '../asks.service.ts';

/**
 * §7.3, §7.4, §7.5 — the one sweep over every kind of parked human decision. Callers ask for "the
 * decisions waiting here", never for approvals and then separately for asks: a caller that could
 * cancel one kind and forget the other would leave its turn parked with no prompt to answer.
 */
@Injectable()
export class PendingDecisionsService {
  constructor(
    private readonly approvalsService: ApprovalsService,
    private readonly asksService: AsksService
  ) {}

  async cancelPendingIn(channelId: string, reason: 'kill' | 'stop'): Promise<void> {
    await this.approvalsService.cancelPendingIn(channelId, reason);
    await this.asksService.cancelPendingIn(channelId, reason);
  }

  async invalidateAll(reason: 'halt' | 'restart'): Promise<void> {
    await this.approvalsService.invalidateAll(reason);
    await this.asksService.invalidateAll(reason);
  }
}
