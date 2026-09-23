import { AgentRegistry } from '@/agents/agents.registry.ts';
import { PendingDecisionsService } from '@/approvals/decisions/pending-decisions.service.ts';
import { TurnControlRegistry } from '@/turns/control/turn-control.registry.ts';

import { CommandHandler } from '../commands.handler.ts';

import type { CommandInput, CommandResponse } from '../commands.types.ts';

/** §7.5 — the shared shape of /stop and /kill: flag the running turns, cancel every parked decision, name what was reached */
export abstract class ChannelInterruptHandler extends CommandHandler {
  protected abstract readonly abortStatus: 'killed' | 'stopped';
  protected abstract readonly cancellationReason: 'kill' | 'stop';

  constructor(
    private readonly agentRegistry: AgentRegistry,
    private readonly pendingDecisionsService: PendingDecisionsService,
    private readonly turnControlRegistry: TurnControlRegistry
  ) {
    super();
  }

  async handle(input: CommandInput): Promise<CommandResponse> {
    const flagged = this.turnControlRegistry.abortChannel(input.channelId, this.abortStatus, input.username);
    await this.pendingDecisionsService.cancelPendingIn(input.channelId, this.cancellationReason);
    const reached = flagged.map((username) => this.agentRegistry.displayNameOf(username)).join(', ');
    return {
      audience: 'channel',
      text: flagged.length === 0 ? this.renderNothingRunning() : this.renderInterrupted(reached)
    };
  }

  /** `reached` names the agents whose turns the command flagged, by display name (§3.1) */
  protected abstract renderInterrupted(reached: string): string;

  protected abstract renderNothingRunning(): string;
}
