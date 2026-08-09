import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { ConfigService } from '@/config/config.service.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';

import { ChannelsService } from '../channels.service.ts';

describe('ChannelsService', () => {
  let channelsService: ChannelsService;

  beforeEach(async () => {
    const configService: MockedInstance<ConfigService> = MockFactory.createMock(ConfigService);
    configService.get.mockReturnValue([
      { id: 'channel-all', triggerMode: 'respond-to-all' },
      { id: 'channel-mention', triggerMode: 'mention-required' }
    ]);
    const moduleRef = await Test.createTestingModule({
      providers: [ChannelsService, { provide: ConfigService, useValue: configService }]
    }).compile();
    channelsService = moduleRef.get(ChannelsService);
  });

  it('should return the configured mode for a listed channel', () => {
    expect(channelsService.getTriggerMode({ channelId: 'channel-all', isDirectMessage: false })).toBe('respond-to-all');
  });

  it('should default an unlisted channel to mention-required', () => {
    expect(channelsService.getTriggerMode({ channelId: 'channel-other', isDirectMessage: false })).toBe(
      'mention-required'
    );
  });

  it('should treat a direct message as respond-to-all regardless of configuration', () => {
    expect(channelsService.getTriggerMode({ channelId: 'channel-dm', isDirectMessage: true })).toBe('respond-to-all');
  });

  it('should list only the declared respond-to-all channels the §3.10 rule applies to', () => {
    expect(channelsService.listRespondToAllChannelIds()).toStrictEqual(['channel-all']);
  });
});
