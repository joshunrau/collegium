import { Injectable } from '@nestjs/common';

import { RosterService } from '@/channels/roster/roster.service.ts';
import { ChatGateway } from '@/chat/chat.gateway.ts';
import { TransportRegistry } from '@/chat/transports/transport.registry.ts';
import { LoggingService } from '@/logging/logging.service.ts';

import { renderCommandListing } from './commands.definitions.ts';
import { CommandRegistry } from './commands.registry.ts';
import { splitSubcommand } from './commands.utils.ts';

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
    private readonly commandRegistry: CommandRegistry,
    private readonly loggingService: LoggingService,
    private readonly rosterService: RosterService,
    private readonly transportRegistry: TransportRegistry
  ) {}

  /** text is everything after `/collegium`; a bare or unrecognised subcommand earns the listing, not a 400 */
  async dispatch(input: CommandInput): Promise<InvokerResponse> {
    const { remainder, subcommand } = splitSubcommand(input.text);
    const handler = subcommand === undefined ? undefined : this.commandRegistry.resolve(subcommand);
    if (!handler) {
      const preface = subcommand === undefined ? '' : `Unknown subcommand "${subcommand}".\n`;
      return { responseType: 'ephemeral', text: `${preface}${renderCommandListing()}` };
    }
    return this.run(handler, { ...input, text: remainder });
  }

  /**
   * §7.5 — the system bot where it is present, and under the agent's own account in a DM, where
   * Mattermost fixes membership at creation and admits no third party. The DM case is recognised by
   * the post failing over a channel holding exactly one agent, rather than by asking the substrate
   * what kind of channel it is: the answer that matters is whether the notice landed.
   */
  private async announce(channelId: string, response: CommandResponse): Promise<boolean> {
    const posted = await this.chatGateway.postAsSystemIn(channelId, response.text);
    if (posted.success) {
      return true;
    }
    const [agent, ...alsoPresent] = this.rosterService.listAgentsIn(channelId);
    if (!agent || alsoPresent.length > 0) {
      this.loggingService.error(new Error(`failed to announce a command in ${channelId}: ${posted.error.message}`));
      return false;
    }
    const relayed = await this.transportRegistry.get(agent.username).send({ channelId, text: response.text });
    if (!relayed.success) {
      this.loggingService.error(new Error(`failed to announce a command in ${channelId}: ${relayed.error.message}`));
      return false;
    }
    return true;
  }

  private async run(handler: CommandHandler, input: CommandInput): Promise<InvokerResponse> {
    const response = await handler.handle(input);
    if (response.audience === 'invoker') {
      return { responseType: 'ephemeral', text: response.text };
    }
    const announced = await this.announce(input.channelId, response);
    await response.afterAnnouncing?.();
    // A4 — an interrupt notice is the only record a stopped turn leaves (the engine posts none of
    // its own), so one that reached no channel is told to the invoker rather than lost
    return announced ? SILENT : { responseType: 'ephemeral', text: response.text };
  }
}
