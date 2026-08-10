import { Injectable } from '@nestjs/common';

import { ActivationService } from '@/activation/activation.service.ts';
import { HaltService } from '@/halt/halt.service.ts';

import { CommandHandler } from '../commands.handler.ts';

import type { CommandInput, CommandResponse } from '../commands.types.ts';

/** §8.4 — clears a global halt, refusing while the condition that raised it still holds */
@Injectable()
export class ResumeHandler extends CommandHandler {
  readonly trigger = 'resume';

  constructor(
    private readonly activationService: ActivationService,
    private readonly haltService: HaltService
  ) {
    super();
  }

  async handle(input: CommandInput): Promise<CommandResponse> {
    const resumed = await this.haltService.resume(input.username);
    if (!resumed.success) {
      const text =
        resumed.error.kind === 'not-halted'
          ? 'Nothing is halted.'
          : `⛔ Cannot resume: respond-to-all channel ${resumed.error.channelId} still holds more than one agent. Remove the extra agents first.`;
      return { audience: 'channel', text };
    }
    return {
      afterAnnouncing: () => this.activationService.sweep(),
      audience: 'channel',
      text: '🟢 Resumed — queued work is draining.'
    };
  }
}
