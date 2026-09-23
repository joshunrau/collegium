import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import type { AgentProfile } from '@/agents/agents.types.ts';
import { RosterService } from '@/channels/roster/roster.service.ts';
import { WindowService } from '@/conversations/window/window.service.ts';
import { TextFormatter } from '@/formatting/text/text.formatter.ts';
import { buildAgentProfile } from '@/testing/factories/agent-profile.factory.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';
import { ToolRegistry } from '@/tools/tools.registry.ts';

import { PeersSection } from '../peers.section.ts';

const PEER = { displayName: 'Tess', expertise: 'scheduling', username: 'tess' } as AgentProfile;

describe('PeersSection', () => {
  let peersSection: PeersSection;
  let rosterService: MockedInstance<RosterService>;
  let toolRegistry: MockedInstance<ToolRegistry>;
  let windowService: MockedInstance<WindowService>;

  beforeEach(async () => {
    rosterService = MockFactory.createMock(RosterService);
    rosterService.getPeers.mockReturnValue([]);
    toolRegistry = MockFactory.createMock(ToolRegistry);
    toolRegistry.listGrantedNamespacesFor.mockReturnValue([]);
    windowService = MockFactory.createMock(WindowService);
    windowService.listRecentPeople.mockResolvedValue([]);
    const moduleRef = await Test.createTestingModule({
      providers: [
        PeersSection,
        TextFormatter,
        { provide: RosterService, useValue: rosterService },
        { provide: ToolRegistry, useValue: toolRegistry },
        { provide: WindowService, useValue: windowService }
      ]
    }).compile();
    peersSection = moduleRef.get(PeersSection);
  });

  const render = () => {
    return peersSection.render({
      channelId: 'channel-1',
      profile: buildAgentProfile(),
      windowReachesBackTo: undefined
    });
  };

  it('should ask the roster for the peers of this agent in this channel', async () => {
    expect(await render()).toBeUndefined();
    expect(rosterService.getPeers).toHaveBeenCalledWith('channel-1', 'mira');
  });

  it('should list each peer by name and handle, with its expertise (§3.11)', async () => {
    rosterService.getPeers.mockReturnValue([PEER]);
    expect(await render()).toBe(`## Peers

Colleagues in this channel and what each is asked about. The toolsets say what each can do, not what should be handed over:

- Tess (@tess) — scheduling (toolsets: none)`);
  });

  it('should list the toolsets each peer was granted by namespace (§3.11)', async () => {
    rosterService.getPeers.mockReturnValue([PEER]);
    toolRegistry.listGrantedNamespacesFor.mockReturnValue(['prospects', 'tasks', 'web']);
    expect(await render()).toContain('- Tess (@tess) — scheduling (toolsets: prospects, tasks, web)');
    expect(toolRegistry.listGrantedNamespacesFor).toHaveBeenCalledWith(PEER);
  });

  it('should name the five latest people to post here by handle, with no peer present (§3.11)', async () => {
    windowService.listRecentPeople.mockResolvedValue(['casey', 'joshua']);
    expect(await render()).toBe(`## People here

The people who posted in this channel most recently, latest first: @casey, @joshua`);
    expect(windowService.listRecentPeople).toHaveBeenCalledWith({
      agentUsername: 'mira',
      channelId: 'channel-1',
      take: 5
    });
  });

  it('should put the people ahead of the peers (§3.11)', async () => {
    windowService.listRecentPeople.mockResolvedValue(['casey']);
    rosterService.getPeers.mockReturnValue([PEER]);
    expect(await render()).toMatch(/^## People here\n\n.*@casey\n\n## Peers\n/u);
  });
});
