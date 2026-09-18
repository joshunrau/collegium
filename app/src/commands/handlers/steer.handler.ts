import { Injectable } from '@nestjs/common';

import { TurnControlRegistry } from '@/turns/control/turn-control.registry.ts';

import { renderUsage } from '../commands.definitions.ts';
import { CommandHandler } from '../commands.handler.ts';
import { renderSteerResponse } from './steer.utils.ts';

import type { CommandInput, CommandResponse } from '../commands.types.ts';

/** §7.5 — one instruction to the turns running here; ephemeral, so the text can never re-activate anyone */
@Injectable()
export class SteerHandler extends CommandHandler {
  readonly trigger = 'steer';

  constructor(private readonly turnControlRegistry: TurnControlRegistry) {
    super();
  }

  handle(input: CommandInput): Promise<CommandResponse> {
    const text = input.text.trim();
    if (text === '') {
      return Promise.resolve({ audience: 'invoker', text: renderUsage(this.trigger) });
    }
    const steered = this.turnControlRegistry.steerChannel(input.channelId, { byUsername: input.username, text });
    return Promise.resolve({ audience: 'invoker', text: renderSteerResponse(steered) });
  }
}
