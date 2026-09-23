import { Injectable } from '@nestjs/common';

import { RosterService } from '@/channels/roster/roster.service.ts';
import { TurnControlRegistry } from '@/turns/control/turn-control.registry.ts';

import { renderUsage } from '../commands.definitions.ts';
import { CommandHandler } from '../commands.handler.ts';
import { readAddressedSteer, renderSteerResponse } from './steer.utils.ts';

import type { CommandInput, CommandResponse } from '../commands.types.ts';

/** §7.5 — one instruction to one agent's running turn here; ephemeral, so the text can never re-activate anyone */
@Injectable()
export class SteerHandler extends CommandHandler {
  readonly trigger = 'steer';

  constructor(
    private readonly rosterService: RosterService,
    private readonly turnControlRegistry: TurnControlRegistry
  ) {
    super();
  }

  handle(input: CommandInput): Promise<CommandResponse> {
    const agentUsernamesHere = this.rosterService.listAgentsIn(input.channelId).map((profile) => profile.username);
    const { agentUsername, text } = readAddressedSteer(input.text, agentUsernamesHere);
    if (text === '') {
      return Promise.resolve({ audience: 'invoker', text: renderUsage(this.trigger) });
    }
    const steered = this.turnControlRegistry.steer(input.channelId, agentUsername, {
      byUsername: input.username,
      text
    });
    return Promise.resolve({ audience: 'invoker', text: renderSteerResponse(steered) });
  }
}
