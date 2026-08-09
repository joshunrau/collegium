import { Injectable } from '@nestjs/common';

import { ChatGateway } from '@/chat/chat.gateway.ts';
import { LoggingService } from '@/logging/logging.service.ts';

import type { CommandHandler } from './commands.handler.ts';
import type { CommandInput, CommandResponse } from './commands.types.ts';

/** what Mattermost renders for the human who typed the command */
type InvokerResponse = {
  responseType: 'ephemeral';
  text: string;
};

/** Mattermost renders nothing for an empty response, which is right when the channel already has it */
const SILENT: InvokerResponse = { responseType: 'ephemeral', text: '' };

/**
 * Runs one command and places its output. Channel-visible output is the system bot's (§3.2): an
 * `in_channel` command response is attributed to the invoking human instead, which makes mechanical
 * text indistinguishable from something a person said — down to folding into that person's live turn.
 */
@Injectable()
export class CommandsService {
  constructor(
    private readonly chatGateway: ChatGateway,
    private readonly loggingService: LoggingService
  ) {}

  async run(handler: CommandHandler, input: CommandInput): Promise<InvokerResponse> {
    const response = await handler.handle(input);
    if (response.audience === 'invoker') {
      return { responseType: 'ephemeral', text: response.text };
    }
    await this.announce(input.channelId, response);
    await response.afterAnnouncing?.();
    return SILENT;
  }

  private async announce(channelId: string, response: CommandResponse): Promise<void> {
    const posted = await this.chatGateway.postAsSystemIn(channelId, response.text);
    if (!posted.success) {
      this.loggingService.error(new Error(`failed to announce a command in ${channelId}: ${posted.error.message}`));
    }
  }
}
