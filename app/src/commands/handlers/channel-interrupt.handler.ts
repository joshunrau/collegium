import { ApprovalsService } from '@/approvals/approvals.service.ts';
import { TurnControlRegistry } from '@/turns/control/turn-control.registry.ts';

import { CommandHandler } from '../commands.handler.ts';

import type { CommandInput, CommandResponse } from '../commands.types.ts';

/** §7.5 — the shared shape of /stop and /kill: flag the running turns, cancel the parked approval */
export abstract class ChannelInterruptHandler extends CommandHandler {
  protected abstract readonly abortStatus: 'killed' | 'stopped';
  protected abstract readonly cancellationReason: 'kill' | 'stop';

  constructor(
    private readonly approvalsService: ApprovalsService,
    private readonly turnControlRegistry: TurnControlRegistry
  ) {
    super();
  }

  async handle(input: CommandInput): Promise<CommandResponse> {
    const flagged = this.turnControlRegistry.abortChannel(input.channelId, this.abortStatus);
    await this.approvalsService.cancelPendingIn(input.channelId, this.cancellationReason);
    return {
      audience: 'channel',
      text: flagged === 0 ? this.renderNothingRunning() : this.renderInterrupted(flagged)
    };
  }

  protected abstract renderInterrupted(flagged: number): string;

  protected abstract renderNothingRunning(): string;
}
