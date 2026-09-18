import { Injectable } from '@nestjs/common';

import { PendingDecisionsService } from '@/approvals/decisions/pending-decisions.service.ts';
import { TurnControlRegistry } from '@/turns/control/turn-control.registry.ts';

import { ChannelInterruptHandler } from './channel-interrupt.handler.ts';

/** §7.5 — the honest guarantee is "no further tool calls", not "nothing happened" */
@Injectable()
export class StopHandler extends ChannelInterruptHandler {
  protected readonly abortStatus = 'stopped';
  protected readonly cancellationReason = 'stop';
  readonly trigger = 'stop';

  constructor(pendingDecisionsService: PendingDecisionsService, turnControlRegistry: TurnControlRegistry) {
    super(pendingDecisionsService, turnControlRegistry);
  }

  protected renderInterrupted(flagged: number): string {
    return `⏹️ Stopped ${flagged} turn(s) before any further tool call.`;
  }

  protected renderNothingRunning(): string {
    return '⏹️ Nothing running here to stop.';
  }
}
