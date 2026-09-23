import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { AgentRegistry } from '@/agents/agents.registry.ts';
import { ConfigService } from '@/config/config.service.ts';
import { PinsService } from '@/conversations/pins/pins.service.ts';
import { DayFormatter } from '@/formatting/dates/day.formatter.ts';
import { TextFormatter } from '@/formatting/text/text.formatter.ts';
import type { AuthorKind, ModelRow } from '@/prisma/prisma.types.ts';
import { buildAgentProfile } from '@/testing/factories/agent-profile.factory.ts';
import { createConfigServiceMock } from '@/testing/factories/config-service.factory.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';

import { PinnedPostsSection } from '../pinned-posts.section.ts';

const pinnedPost = (id: string, message: string, authorUsername = 'casey', authorKind: AuthorKind = 'human') => {
  return {
    attachments: null,
    authoringTurnId: null,
    authorKind,
    authorUsername,
    channelId: 'channel-1',
    createdAt: new Date('2026-09-19T15:00:00Z'),
    id,
    isForgotten: false,
    isPinned: true,
    kind: 'message',
    message,
    observedAt: new Date('2026-09-19T15:00:00Z')
  } satisfies ModelRow<'Post'>;
};

describe('PinnedPostsSection', () => {
  let pinnedPostsSection: PinnedPostsSection;
  let pinsService: MockedInstance<PinsService>;

  beforeEach(async () => {
    const agentRegistry = MockFactory.createMock(AgentRegistry);
    agentRegistry.displayNameOf.mockImplementation((username) => (username === 'tess' ? 'Tess' : username));
    pinsService = MockFactory.createMock(PinsService);
    pinsService.listPinned.mockResolvedValue([]);
    const moduleRef = await Test.createTestingModule({
      providers: [
        DayFormatter,
        PinnedPostsSection,
        TextFormatter,
        { provide: AgentRegistry, useValue: agentRegistry },
        { provide: ConfigService, useValue: createConfigServiceMock({ display: { timezone: 'UTC' } }) },
        { provide: PinsService, useValue: pinsService }
      ]
    }).compile();
    pinnedPostsSection = moduleRef.get(PinnedPostsSection);
  });

  const render = () => {
    return pinnedPostsSection.render({
      channelId: 'channel-1',
      profile: buildAgentProfile(),
      windowReachesBackTo: undefined
    });
  };

  it('should render nothing where nothing is pinned', async () => {
    expect(await render()).toBeUndefined();
    expect(pinsService.listPinned).toHaveBeenCalledWith('channel-1');
  });

  it('should delimit each pinned post under its author, what they are, and the day it was written (§3.8)', async () => {
    pinsService.listPinned.mockResolvedValue([
      pinnedPost('post-1', 'Cite the registry for every lead.'),
      pinnedPost('post-2', 'Rulings so far:\n- no cold calls', 'tess', 'agent')
    ]);
    expect(await render()).toBe(`## Pinned in this channel

Posts pinned in this channel, oldest first. Each one stands until a person unpins it:

By casey (person) on Saturday, September 19, 2026:
<<<post post-1
Cite the registry for every lead.
>>>

By Tess (agent) on Saturday, September 19, 2026:
<<<post post-2
Rulings so far:
- no cold calls
>>>`);
  });

  it('should keep the newest posts under the cap and name the older ones it leaves out (§3.8)', async () => {
    pinsService.listPinned.mockResolvedValue([
      pinnedPost('post-1', 'a'.repeat(4000)),
      pinnedPost('post-2', 'b'.repeat(4000)),
      pinnedPost('post-3', 'c'.repeat(4000))
    ]);
    const rendered = await render();
    expect(rendered).not.toContain('<<<post post-1');
    expect(rendered).not.toContain('<<<post post-2');
    expect(rendered).toContain('<<<post post-3');
    expect(rendered).toMatch(
      /\n\n2 older pinned posts are left out, because this section holds about 2,000 tokens: post-1, post-2\.$/u
    );
  });
});
