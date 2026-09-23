import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import type { AgentProfile } from '@/agents/agents.types.ts';
import { RosterService } from '@/channels/roster/roster.service.ts';
import { TextFormatter } from '@/formatting/text/text.formatter.ts';
import { buildAgentProfile } from '@/testing/factories/agent-profile.factory.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';
import { ToolRegistry } from '@/tools/tools.registry.ts';

import { PeersSection } from '../peers.section.ts';

const PEER = { expertise: 'scheduling', username: 'tess' } as AgentProfile;

describe('PeersSection', () => {
  let peersSection: PeersSection;
  let rosterService: MockedInstance<RosterService>;
  let toolRegistry: MockedInstance<ToolRegistry>;

  beforeEach(async () => {
    rosterService = MockFactory.createMock(RosterService);
    rosterService.getPeers.mockReturnValue([]);
    toolRegistry = MockFactory.createMock(ToolRegistry);
    toolRegistry.listGrantedNamespacesFor.mockReturnValue([]);
    const moduleRef = await Test.createTestingModule({
      providers: [
        PeersSection,
        TextFormatter,
        { provide: RosterService, useValue: rosterService },
        { provide: ToolRegistry, useValue: toolRegistry }
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

  it('should ask the roster for the peers of this agent in this channel', () => {
    expect(render()).toBeUndefined();
    expect(rosterService.getPeers).toHaveBeenCalledWith('channel-1', 'mira');
  });

  it('should list each peer with its expertise', () => {
    rosterService.getPeers.mockReturnValue([PEER]);
    expect(render()).toBe(`## Peers

Colleagues in this channel and what each is asked about. The toolsets say what each can do, not what should be handed over:

- @tess — scheduling (toolsets: none)`);
  });

  it('should list the toolsets each peer was granted by namespace (§3.11)', () => {
    rosterService.getPeers.mockReturnValue([PEER]);
    toolRegistry.listGrantedNamespacesFor.mockReturnValue(['prospects', 'tasks', 'web']);
    expect(render()).toContain('- @tess — scheduling (toolsets: prospects, tasks, web)');
    expect(toolRegistry.listGrantedNamespacesFor).toHaveBeenCalledWith(PEER);
  });
});
