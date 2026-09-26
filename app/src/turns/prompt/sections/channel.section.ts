import { Injectable } from '@nestjs/common';

import { RosterService } from '@/channels/roster/roster.service.ts';
import { TextFormatter } from '@/formatting/text/text.formatter.ts';

import type { TurnPromptInput } from '../prompt.types.ts';

/**
 * §3.8 — which channel this turn runs in, so a memory or a ruling that names a channel is read
 * against the right one; the handle is shown where it differs from the name, since that is how
 * people and plugin records name a lane. Omitted where the roster does not know the channel.
 */
@Injectable()
export class ChannelSection {
  constructor(
    private readonly rosterService: RosterService,
    private readonly textFormatter: TextFormatter
  ) {}

  render({ channelId, profile }: TurnPromptInput): string | undefined {
    const channel = this.rosterService.describe(channelId, profile.username);
    if (channel === undefined) {
      return undefined;
    }
    const where =
      channel.kind === 'direct'
        ? `a direct message with ${channel.name}`
        : channel.kind === 'group'
          ? `a group message with ${channel.name}`
          : channel.handle === undefined || channel.handle === channel.name
            ? channel.name
            : `${channel.name} (~${channel.handle})`;
    return this.textFormatter.formatParagraphs(['## Channel', 'This turn runs in {where}.'], { where });
  }
}
