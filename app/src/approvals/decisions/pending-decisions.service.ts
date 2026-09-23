import { Injectable } from '@nestjs/common';

import { ApprovalsService } from '../approvals.service.ts';
import { AsksService } from '../asks.service.ts';

import type { PendingDecision, PendingDecisionScope } from './decisions.types.ts';

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

  /** what restarts a long turn's clock (§7.6) */
  async isWaitingOnPerson(agentUsername: string, channelId: string): Promise<boolean> {
    return (
      (await this.approvalsService.hasPendingFor(agentUsername, channelId)) ||
      (await this.asksService.hasPendingFor(agentUsername, channelId))
    );
  }

  /**
   * §8.4 — every decision in the scope still parked on a human, oldest first, since the oldest
   * blocks the deepest queue (§5.2). Who may see one is the caller's rule, not this module's:
   * approvals own what is pending, never who is entitled to read it.
   */
  async listPending(scope: PendingDecisionScope): Promise<PendingDecision[]> {
    const [approvals, asks] = await Promise.all([
      this.approvalsService.listPending(scope),
      this.asksService.listPending(scope)
    ]);
    return [...approvals, ...asks].toSorted((left, right) => left.requestedAt.getTime() - right.requestedAt.getTime());
  }
}
