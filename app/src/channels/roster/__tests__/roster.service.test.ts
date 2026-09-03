import { Result } from '@collegium/core/utils';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { AgentRegistry } from '@/agents/agents.registry.ts';
import type { AgentProfile } from '@/agents/agents.types.ts';
import type { ChatTransport } from '@/chat/chat.transport.ts';
import type { ChatFailure } from '@/chat/chat.types.ts';
import { TransportRegistry } from '@/chat/transports/transport.registry.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';

import { ChannelsService } from '../../channels.service.ts';
import { RosterService } from '../roster.service.ts';

const profile = (username: string): AgentProfile => ({ username }) as AgentProfile;

describe('RosterService', () => {
  let agentRegistry: MockedInstance<AgentRegistry>;
  let channelsService: MockedInstance<ChannelsService>;
  let membershipFailure: ChatFailure | undefined;
  let membershipsByAgent: { [username: string]: string[] };
  let membershipCalls: string[];
  let rosterService: RosterService;

  beforeEach(async () => {
    agentRegistry = MockFactory.createMock(AgentRegistry);
    agentRegistry.list.mockReturnValue([profile('mira'), profile('tess')]);
    agentRegistry.get.mockImplementation((username) => profile(username));
    channelsService = MockFactory.createMock(ChannelsService);
    channelsService.listRespondToAllChannelIds.mockReturnValue([]);
    membershipFailure = undefined;
    membershipsByAgent = { mira: ['channel-1'], tess: ['channel-1', 'channel-2'] };
    membershipCalls = [];
    const transportRegistry = {
      get: (username: string): ChatTransport => {
        return {
          getChannelMemberships: () => {
            membershipCalls.push(username);
            return Promise.resolve(
              membershipFailure ? Result.err(membershipFailure) : Result.ok(membershipsByAgent[username] ?? [])
            );
          }
        } as ChatTransport;
      }
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        RosterService,
        { provide: AgentRegistry, useValue: agentRegistry },
        { provide: ChannelsService, useValue: channelsService },
        { provide: TransportRegistry, useValue: transportRegistry }
      ]
    }).compile();
    rosterService = moduleRef.get(RosterService);
  });

  it('should reconcile against the API on boot, once per agent under its own identity', async () => {
    await rosterService.reconcile();
    expect(membershipCalls.toSorted()).toStrictEqual(['mira', 'tess']);
    expect(rosterService.getPeers('channel-1', 'mira').map((peer) => peer.username)).toStrictEqual(['tess']);
  });

  it('should exclude the agent itself from its peers', async () => {
    await rosterService.reconcile();
    expect(rosterService.getPeers('channel-2', 'tess')).toStrictEqual([]);
  });

  it('should maintain membership from websocket events rather than polling again', async () => {
    await rosterService.reconcile();
    rosterService.onMembershipEvent({ agentUsername: 'mira', channelId: 'channel-2', kind: 'user_added_to_channel' });
    expect(rosterService.getPeers('channel-2', 'tess').map((peer) => peer.username)).toStrictEqual(['mira']);
    rosterService.onMembershipEvent({
      agentUsername: 'mira',
      channelId: 'channel-2',
      kind: 'user_removed_from_channel'
    });
    expect(rosterService.getPeers('channel-2', 'tess')).toStrictEqual([]);
    expect(membershipCalls).toHaveLength(2);
  });

  it('should abandon reconciliation rather than cache a partial roster', async () => {
    membershipFailure = { kind: 'api', message: 'gateway timeout' };
    expect((await rosterService.reconcile()).error).toStrictEqual(membershipFailure);
    expect(membershipCalls).toStrictEqual(['mira']);
    expect(rosterService.listAgentsIn('channel-1')).toStrictEqual([]);
  });

  it('should report whether a named agent sits in a channel', async () => {
    await rosterService.reconcile();
    expect(rosterService.isAgentIn('mira', 'channel-1')).toBe(true);
    expect(rosterService.isAgentIn('mira', 'channel-2')).toBe(false);
    expect(rosterService.isAgentIn('mira', 'channel-unknown')).toBe(false);
  });

  it('should record a membership event for a channel it has never seen', async () => {
    await rosterService.reconcile();
    rosterService.onMembershipEvent({ agentUsername: 'mira', channelId: 'channel-9', kind: 'user_added_to_channel' });
    expect(rosterService.listAgentsIn('channel-9').map((agent) => agent.username)).toStrictEqual(['mira']);
  });

  it('should skip a member the registry no longer knows', async () => {
    agentRegistry.get.mockImplementation((username) => (username === 'tess' ? profile('tess') : undefined));
    await rosterService.reconcile();
    expect(rosterService.listAgentsIn('channel-1').map((agent) => agent.username)).toStrictEqual(['tess']);
  });

  it('should see no violation in a respond-to-all channel no agent has joined', async () => {
    channelsService.listRespondToAllChannelIds.mockReturnValue(['channel-9']);
    await rosterService.reconcile();
    expect(rosterService.findRespondToAllViolation()).toBeUndefined();
  });

  it('should refuse to boot when a respond-to-all channel holds two agents', async () => {
    channelsService.listRespondToAllChannelIds.mockReturnValue(['channel-1']);
    await expect(rosterService.reconcile()).rejects.toThrow('respond-to-all channel "channel-1" holds 2 agents');
  });

  it('should report a violation when a membership event makes a respond-to-all channel two-agent', async () => {
    channelsService.listRespondToAllChannelIds.mockReturnValue(['channel-2']);
    await rosterService.reconcile();
    const violation = rosterService.onMembershipEvent({
      agentUsername: 'mira',
      channelId: 'channel-2',
      kind: 'user_added_to_channel'
    });
    expect(violation).toStrictEqual({ agentUsernames: ['tess', 'mira'], channelId: 'channel-2' });
  });
});
