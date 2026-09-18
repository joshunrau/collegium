import { Injectable } from '@nestjs/common';

import { PendingDecisionsService } from '@/approvals/decisions/pending-decisions.service.ts';
import { TurnControlRegistry } from '@/turns/control/turn-control.registry.ts';

import { ChannelInterruptHandler } from './channel-interrupt.handler.ts';

/** §7.5 — immediate abandonment: a tool already in flight may still land its side effect */
@Injectable()
export class KillHandler extends ChannelInterruptHandler {
  protected readonly abortStatus = 'killed';
  protected readonly cancellationReason = 'kill';
  readonly trigger = 'kill';

  constructor(pendingDecisionsService: PendingDecisionsService, turnControlRegistry: TurnControlRegistry) {
    super(pendingDecisionsService, turnControlRegistry);
  }

  protected renderInterrupted(flagged: number): string {
    return `⏹️ Killed ${flagged} turn(s).`;
  }

  protected renderNothingRunning(): string {
    return '⏹️ Nothing running here to kill.';
  }
}
