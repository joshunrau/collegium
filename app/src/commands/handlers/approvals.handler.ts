import { Injectable } from '@nestjs/common';

import { AgentRegistry } from '@/agents/agents.registry.ts';
import { ApprovalsService } from '@/approvals/approvals.service.ts';
import type { PendingApproval } from '@/approvals/approvals.types.ts';
import { resolveActingHuman } from '@/approvals/decisions/human-presence.utils.ts';
import { RosterService } from '@/channels/roster/roster.service.ts';
import { TransportRegistry } from '@/chat/transports/transport.registry.ts';

import { CommandHandler } from '../commands.handler.ts';
import { renderNothingWaiting, renderPendingApprovals } from './approvals.utils.ts';
import { requireAgentName } from './argument.utils.ts';

import type { CommandInput, CommandResponse } from '../commands.types.ts';
import type { PendingApprovalListing } from './approvals.utils.ts';

/** §8.4 — what is still parked on a human, in the channels the invoker is in; it decides nothing */
@Injectable()
export class ApprovalsHandler extends CommandHandler {
  readonly trigger = 'approvals';

  constructor(
    private readonly agentRegistry: AgentRegistry,
    private readonly approvalsService: ApprovalsService,
    private readonly rosterService: RosterService,
    private readonly transportRegistry: TransportRegistry
  ) {
    super();
  }

  async handle(input: CommandInput): Promise<CommandResponse> {
    const argument = input.text.trim();
    const named = argument === '' ? undefined : requireAgentName(this.agentRegistry, argument, this.trigger);
    if (named && !named.success) {
      return named.error;
    }
    const pending = await this.approvalsService.listPending(named?.value);
    const visible = await this.keepVisibleTo(pending, input.userId);
    if (visible.length === 0) {
      return { audience: 'invoker', text: renderNothingWaiting() };
    }
    return { audience: 'invoker', text: renderPendingApprovals(visible, new Date()) };
  }

  /**
   * §3.7's own predicate, asked once per distinct channel rather than once per approval, and read
   * live because membership is what confers the right to see a prompt at all. A check that cannot
   * be answered omits the row: failing closed is the only safe direction on an authority read.
   */
  private async keepVisibleTo(pending: readonly PendingApproval[], userId: string): Promise<PendingApprovalListing[]> {
    const membership = new Map<string, boolean>();
    for (const row of pending) {
      if (membership.has(row.channelId)) {
        continue;
      }
      const human = await resolveActingHuman(this.transportRegistry, row.agentUsername, row.channelId, userId);
      membership.set(row.channelId, human.success);
    }
    return pending
      .filter((row) => membership.get(row.channelId) === true)
      .map((row) => ({ ...row, channelName: this.rosterService.nameOf(row.channelId, row.agentUsername) }));
  }
}
