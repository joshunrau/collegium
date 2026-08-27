import type { $TriggeringMode } from '@collegium/config';
import { describe, expect, it } from 'vitest';

import { ChannelsService } from '../channels.service.ts';

describe('ChannelsService', () => {
  const channelsService = new ChannelsService(
    new Map<string, $TriggeringMode>([
      ['channel-all', 'respond-to-all'],
      ['channel-mention', 'mention-required']
    ])
  );

  it('should return the configured mode for a listed channel', () => {
    expect(channelsService.getTriggeringMode({ channelId: 'channel-all', isDirectMessage: false })).toBe(
      'respond-to-all'
    );
  });

  it('should default an unlisted channel to mention-required', () => {
    expect(channelsService.getTriggeringMode({ channelId: 'channel-other', isDirectMessage: false })).toBe(
      'mention-required'
    );
  });

  it('should treat a direct message as respond-to-all regardless of configuration', () => {
    expect(channelsService.getTriggeringMode({ channelId: 'channel-dm', isDirectMessage: true })).toBe(
      'respond-to-all'
    );
  });

  it('should list only the declared respond-to-all channels the §3.10 rule applies to', () => {
    expect(channelsService.listRespondToAllChannelIds()).toStrictEqual(['channel-all']);
  });
});
