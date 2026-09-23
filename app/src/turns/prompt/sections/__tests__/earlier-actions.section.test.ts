import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { WindowService } from '@/conversations/window/window.service.ts';
import { TextFormatter } from '@/formatting/text/text.formatter.ts';
import { buildAgentProfile } from '@/testing/factories/agent-profile.factory.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';

import { EarlierActionsSection } from '../earlier-actions.section.ts';

describe('EarlierActionsSection', () => {
  let earlierActionsSection: EarlierActionsSection;
  let windowService: MockedInstance<WindowService>;

  beforeEach(async () => {
    windowService = MockFactory.createMock(WindowService);
    windowService.readRecentActions.mockResolvedValue([]);
    const moduleRef = await Test.createTestingModule({
      providers: [EarlierActionsSection, TextFormatter, { provide: WindowService, useValue: windowService }]
    }).compile();
    earlierActionsSection = moduleRef.get(EarlierActionsSection);
  });

  const render = (windowReachesBackTo: Date | undefined) => {
    return earlierActionsSection.render({ channelId: 'channel-1', profile: buildAgentProfile(), windowReachesBackTo });
  };

  it('should omit the earlier actions section when the window reaches the start of the channel (§3.8)', async () => {
    windowService.readRecentActions.mockResolvedValue(['[read notes.md (12 bytes)]']);
    expect(await render(undefined)).toBeUndefined();
    expect(windowService.readRecentActions).not.toHaveBeenCalled();
  });

  it('should omit the earlier actions section when nothing this agent did precedes the window (§3.8)', async () => {
    expect(await render(new Date(1000))).toBeUndefined();
  });

  it('should ask for twenty of its own actions from before the window (§3.8)', async () => {
    await render(new Date(1000));
    expect(windowService.readRecentActions).toHaveBeenCalledWith({
      agentUsername: 'mira',
      before: new Date(1000),
      channelId: 'channel-1',
      take: 20
    });
  });

  it('should collapse a run of identical earlier action lines (§3.8)', async () => {
    windowService.readRecentActions.mockResolvedValue([
      '[fetched https://x/a]',
      '[fetched https://x/a]',
      '[ran ls (0)]'
    ]);
    expect(await render(new Date(1000))).toContain('- [fetched https://x/a] (x2)\n- [ran ls (0)]');
  });
});
