import { Injectable } from '@nestjs/common';

import { ChannelAnnouncer } from '@/notifications/announcing/channel-announcer.service.ts';

import { renderSurfaceUsage } from './commands.definitions.ts';
import { CommandRegistry } from './commands.registry.ts';

import type { CommandHandler } from './commands.handler.ts';
import type { CommandInput } from './commands.types.ts';

/** what Mattermost renders for the human who typed the command */
type InvokerResponse = {
  responseType: 'ephemeral';
  text: string;
};

/** Mattermost renders nothing for an empty response, which is right when the channel already has it */
const SILENT: InvokerResponse = { responseType: 'ephemeral', text: '' };

const UNANNOUNCED = 'The announcement could not be posted in this channel, so nothing was changed.';

/**
 * Runs one command and places its output. Channel-visible output is the system bot's (§3.2): an
 * `in_channel` command response is attributed to the invoking human instead, which makes mechanical
 * text indistinguishable from something a person said — down to folding into that person's live turn.
 */
@Injectable()
export class CommandsService {
  constructor(
    private readonly channelAnnouncer: ChannelAnnouncer,
    private readonly commandRegistry: CommandRegistry
  ) {}

  /** the text after `/collegium` as the plugin forwards it; a bare or undeclared subcommand is answered with the surface */
  async execute(input: CommandInput): Promise<InvokerResponse> {
    const resolved = this.commandRegistry.resolve(input.text);
    if (!resolved) {
      return { responseType: 'ephemeral', text: renderSurfaceUsage() };
    }
    return this.run(resolved.handler, { ...input, text: resolved.text });
  }

  private async run(handler: CommandHandler, input: CommandInput): Promise<InvokerResponse> {
    const response = await handler.handle(input);
    if (response.audience === 'invoker') {
      return { responseType: 'ephemeral', text: response.text };
    }
    const announced = await this.channelAnnouncer.announce(input.channelId, response.text);
    await response.afterAnnouncing?.();
    if (announced !== undefined) {
      await response.onAnnounced?.(announced.postId);
      return SILENT;
    }
    // §3.15 — work that only exists once announced did not happen, and the invoker must not read otherwise
    if (response.onAnnounced) {
      return { responseType: 'ephemeral', text: UNANNOUNCED };
    }
    // A4 — an interrupt notice is the only record a stopped turn leaves (the engine posts none of
    // its own), so one that reached no channel is told to the invoker rather than lost
    return { responseType: 'ephemeral', text: response.text };
  }
}
