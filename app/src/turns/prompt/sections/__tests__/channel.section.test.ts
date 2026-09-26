import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { RosterService } from '@/channels/roster/roster.service.ts';
import { TextFormatter } from '@/formatting/text/text.formatter.ts';
import { buildAgentProfile } from '@/testing/factories/agent-profile.factory.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';

import { ChannelSection } from '../channel.section.ts';

describe('ChannelSection', () => {
  let channelSection: ChannelSection;
  let rosterService: MockedInstance<RosterService>;

  beforeEach(async () => {
    rosterService = MockFactory.createMock(RosterService);
    const moduleRef = await Test.createTestingModule({
      providers: [ChannelSection, TextFormatter, { provide: RosterService, useValue: rosterService }]
    }).compile();
    channelSection = moduleRef.get(ChannelSection);
  });

  const render = () => {
    return channelSection.render({
      channelId: 'channel-1',
      profile: buildAgentProfile(),
      windowReachesBackTo: undefined
    });
  };

  it('should name the channel with its handle where the two differ (§3.8)', () => {
    rosterService.describe.mockReturnValue({ handle: 'research4', kind: 'open', name: 'Research 4' });
    expect(render()).toBe('## Channel\n\nThis turn runs in Research 4 (~research4).');
    rosterService.describe.mockReturnValue({ handle: 'Ops', kind: 'private', name: 'Ops' });
    expect(render()).toBe('## Channel\n\nThis turn runs in Ops.');
  });

  it('should say who a direct or group message is with', () => {
    rosterService.describe.mockReturnValue({ handle: undefined, kind: 'direct', name: '@casey' });
    expect(render()).toBe('## Channel\n\nThis turn runs in a direct message with @casey.');
    rosterService.describe.mockReturnValue({ handle: undefined, kind: 'group', name: '@casey, @jo' });
    expect(render()).toBe('## Channel\n\nThis turn runs in a group message with @casey, @jo.');
  });

  it('should say nothing of a channel the roster does not know', () => {
    rosterService.describe.mockReturnValue(undefined);
    expect(render()).toBeUndefined();
  });
});
