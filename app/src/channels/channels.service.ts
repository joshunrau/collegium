import { Injectable } from '@nestjs/common';

import type { $TriggerMode } from '@/config/config.schemas.ts';
import { ConfigService } from '@/config/config.service.ts';

@Injectable()
export class ChannelsService {
  private readonly modes: ReadonlyMap<string, $TriggerMode>;

  constructor(configService: ConfigService) {
    this.modes = new Map(configService.get('channels').map((channel) => [channel.id, channel.triggerMode]));
  }

  /** DMs are respond-to-all inherently, as a property of the channel type (§3.10) */
  getTriggerMode(input: { channelId: string; isDirectMessage: boolean }): $TriggerMode {
    if (input.isDirectMessage) {
      return 'respond-to-all';
    }
    return this.modes.get(input.channelId) ?? 'mention-required';
  }

  /** the channels the §3.10 one-agent rule applies to — declared ones, since a DM cannot gain agents */
  listRespondToAllChannelIds(): readonly string[] {
    return [...this.modes].filter(([, mode]) => mode === 'respond-to-all').map(([channelId]) => channelId);
  }
}
