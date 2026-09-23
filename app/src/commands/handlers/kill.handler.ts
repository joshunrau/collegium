import { Injectable } from '@nestjs/common';

import { AgentRegistry } from '@/agents/agents.registry.ts';
import { PendingDecisionsService } from '@/approvals/decisions/pending-decisions.service.ts';
import { TurnControlRegistry } from '@/turns/control/turn-control.registry.ts';

import { ChannelInterruptHandler } from './channel-interrupt.handler.ts';

/** §7.5 — immediate abandonment: a tool already in flight may still land its side effect */
@Injectable()
export class KillHandler extends ChannelInterruptHandler {
  protected readonly abortStatus = 'killed';
  protected readonly cancellationReason = 'kill';
  readonly trigger = 'kill';

  constructor(
    agentRegistry: AgentRegistry,
    pendingDecisionsService: PendingDecisionsService,
    turnControlRegistry: TurnControlRegistry
  ) {
    super(agentRegistry, pendingDecisionsService, turnControlRegistry);
  }

  protected renderInterrupted(reached: string): string {
    return `⏹️ Killed ${reached}.`;
  }

  protected renderNothingRunning(): string {
    return '⏹️ Nothing running here to kill.';
  }
}
