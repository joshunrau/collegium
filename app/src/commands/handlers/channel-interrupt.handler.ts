import { PendingDecisionsService } from '@/approvals/decisions/pending-decisions.service.ts';
import { TurnControlRegistry } from '@/turns/control/turn-control.registry.ts';

import { CommandHandler } from '../commands.handler.ts';

import type { CommandInput, CommandResponse } from '../commands.types.ts';

/** §7.5 — the shared shape of /stop and /kill: flag the running turns, cancel every parked decision, name what was reached */
export abstract class ChannelInterruptHandler extends CommandHandler {
  protected abstract readonly abortStatus: 'killed' | 'stopped';
  protected abstract readonly cancellationReason: 'kill' | 'stop';

  constructor(
    private readonly pendingDecisionsService: PendingDecisionsService,
    private readonly turnControlRegistry: TurnControlRegistry
  ) {
    super();
  }

  async handle(input: CommandInput): Promise<CommandResponse> {
    const flagged = this.turnControlRegistry.abortChannel(input.channelId, this.abortStatus, input.username);
    await this.pendingDecisionsService.cancelPendingIn(input.channelId, this.cancellationReason);
    return {
      audience: 'channel',
      text: flagged.length === 0 ? this.renderNothingRunning() : this.renderInterrupted(flagged)
    };
  }

  protected abstract renderInterrupted(agentUsernames: readonly string[]): string;

  protected abstract renderNothingRunning(): string;
}
