import { Injectable } from '@nestjs/common';

import { AgentRegistry } from '@/agents/agents.registry.ts';
import { PendingDecisionsService } from '@/approvals/decisions/pending-decisions.service.ts';
import { TurnControlRegistry } from '@/turns/control/turn-control.registry.ts';

import { ChannelInterruptHandler } from './channel-interrupt.handler.ts';

/** §7.5 — the honest guarantee is "no further tool calls", not "nothing happened" */
@Injectable()
export class StopHandler extends ChannelInterruptHandler {
  protected readonly abortStatus = 'stopped';
  protected readonly cancellationReason = 'stop';
  readonly trigger = 'stop';

  constructor(
    agentRegistry: AgentRegistry,
    pendingDecisionsService: PendingDecisionsService,
    turnControlRegistry: TurnControlRegistry
  ) {
    super(agentRegistry, pendingDecisionsService, turnControlRegistry);
  }

  protected renderInterrupted(reached: string): string {
    return `⏹️ Stopped ${reached} before any further tool call.`;
  }

  protected renderNothingRunning(): string {
    return '⏹️ Nothing running here to stop.';
  }
}
