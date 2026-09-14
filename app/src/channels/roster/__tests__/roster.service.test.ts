import { Result } from '@collegium/core/utils';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { AgentRegistry } from '@/agents/agents.registry.ts';
import type { AgentProfile } from '@/agents/agents.types.ts';
import type { ChatTransport } from '@/chat/chat.transport.ts';
import type { ChannelDescription, ChatEvent, ChatFailure } from '@/chat/chat.types.ts';
import { TransportRegistry } from '@/chat/transports/transport.registry.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';

import { ChannelsService } from '../../channels.service.ts';
import { RosterService } from '../roster.service.ts';

const profile = (username: string): AgentProfile => ({ username }) as AgentProfile;

const describedChannels: { [channelId: string]: ChannelDescription } = {
  'channel-1': { displayName: 'Main', kind: 'open', memberUsernames: ['casey', 'mira', 'tess'] },
  'channel-2': { displayName: 'Ops', kind: 'private', memberUsernames: ['casey', 'tess'] },
  'channel-3': { displayName: 'Leads', kind: 'private', memberUsernames: ['casey', 'jo', 'tess'] },
  'channel-9': { displayName: 'Nine', kind: 'open', memberUsernames: ['mira'] },
  'dm-casey-tess': { displayName: '', kind: 'direct', memberUsernames: ['casey', 'tess'] }
};

const event = (overrides: Partial<ChatEvent.Membership>): ChatEvent.Membership => ({
  agentUsername: 'mira',
  channelId: 'channel-2',
  kind: 'user_added_to_channel',
  username: 'mira',
  ...overrides
});

describe('RosterService', () => {
  let agentRegistry: MockedInstance<AgentRegistry>;
  let channelsService: MockedInstance<ChannelsService>;
  let membershipFailure: ChatFailure | undefined;
  let membershipsByAgent: { [username: string]: string[] };
  let membershipCalls: string[];
  let describeCalls: string[];
  let rosterService: RosterService;

  beforeEach(async () => {
    agentRegistry = MockFactory.createMock(AgentRegistry);
    agentRegistry.list.mockReturnValue([profile('mira'), profile('tess')]);
    agentRegistry.get.mockImplementation((username) => {
      return ['mira', 'tess'].includes(username) ? profile(username) : undefined;
    });
    channelsService = MockFactory.createMock(ChannelsService);
    channelsService.listRespondToAllChannelIds.mockReturnValue([]);
    membershipFailure = undefined;
    membershipsByAgent = { mira: ['channel-1'], tess: ['channel-1', 'channel-2', 'channel-3', 'dm-casey-tess'] };
    membershipCalls = [];
    describeCalls = [];
    const transportRegistry = {
      get: (username: string): ChatTransport => {
        return {
          describeChannel: (channelId: string) => {
            describeCalls.push(channelId);
            const described = describedChannels[channelId];
            return Promise.resolve(
              described ? Result.ok(described) : Result.err({ kind: 'api', message: `no channel ${channelId}` })
            );
          },
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

  it('should describe each channel once, by the first agent found in it', async () => {
    await rosterService.reconcile();
    expect(describeCalls.filter((channelId) => channelId === 'channel-1')).toHaveLength(1);
  });

  it('should exclude the agent itself from its peers', async () => {
    await rosterService.reconcile();
    expect(rosterService.getPeers('channel-2', 'tess')).toStrictEqual([]);
  });

  it('should describe a channel whole when the agent itself joins it', async () => {
    await rosterService.reconcile();
    const recorded = await rosterService.onMembershipEvent(event({ channelId: 'channel-2' }));
    expect(recorded.value).toBeUndefined();
    expect(rosterService.getPeers('channel-2', 'tess').map((peer) => peer.username)).toStrictEqual(['mira']);
    expect(membershipCalls).toHaveLength(2);
  });

  it('should return the API failure when the joined channel cannot be described', async () => {
    await rosterService.reconcile();
    const recorded = await rosterService.onMembershipEvent(event({ channelId: 'channel-unknown' }));
    expect(recorded.error).toStrictEqual({ kind: 'api', message: 'no channel channel-unknown' });
    expect(rosterService.isAgentIn('mira', 'channel-unknown')).toBe(false);
  });

  it('should forget a channel once no agent remains to observe it', async () => {
    await rosterService.reconcile();
    await rosterService.onMembershipEvent(event({ channelId: 'channel-1', kind: 'user_removed_from_channel' }));
    expect(rosterService.isAgentIn('tess', 'channel-1')).toBe(true);
    await rosterService.onMembershipEvent(
      event({ agentUsername: 'tess', channelId: 'channel-1', kind: 'user_removed_from_channel', username: 'tess' })
    );
    expect(rosterService.listReachableFrom('tess', 'channel-1')).toStrictEqual([]);
  });

  it('should edit the members already known when someone else moves', async () => {
    await rosterService.reconcile();
    await rosterService.onMembershipEvent(event({ agentUsername: 'tess', channelId: 'channel-2', username: 'jo' }));
    expect(rosterService.listReachableFrom('tess', 'channel-2').map((channel) => channel.name)).toStrictEqual([
      'Main',
      'Ops',
      'Leads'
    ]);
  });

  it('should ignore a movement in a channel no agent observes', async () => {
    await rosterService.reconcile();
    const recorded = await rosterService.onMembershipEvent(
      event({ agentUsername: 'tess', channelId: 'channel-unknown', username: 'jo' })
    );
    expect(recorded.value).toBeUndefined();
    expect(describeCalls).not.toContain('channel-unknown');
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

  it('should count only registered agents among the members', async () => {
    await rosterService.reconcile();
    expect(rosterService.listAgentsIn('channel-1').map((agent) => agent.username)).toStrictEqual(['mira', 'tess']);
  });

  describe('listReachableFrom', () => {
    beforeEach(() => rosterService.reconcile());

    it('should reach only open channels from an open channel', () => {
      expect(rosterService.listReachableFrom('tess', 'channel-1').map((channel) => channel.channelId)).toStrictEqual([
        'channel-1'
      ]);
    });

    it('should reach open channels and closed ones holding everyone present from a private channel', () => {
      expect(rosterService.listReachableFrom('tess', 'channel-2').map((channel) => channel.channelId)).toStrictEqual([
        'channel-1',
        'channel-2',
        'channel-3',
        'dm-casey-tess'
      ]);
    });

    it('should not reach a closed channel missing someone present', () => {
      expect(rosterService.listReachableFrom('tess', 'channel-3').map((channel) => channel.channelId)).toStrictEqual([
        'channel-1',
        'channel-3'
      ]);
    });

    it('should name a direct channel by whoever else is in it', () => {
      const reachable = rosterService.listReachableFrom('tess', 'dm-casey-tess');
      expect(reachable.find((channel) => channel.channelId === 'dm-casey-tess')?.name).toBe('@casey');
    });

    it('should reach nothing from a channel the agent is not in', () => {
      expect(rosterService.listReachableFrom('mira', 'channel-2')).toStrictEqual([]);
    });
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
    const recorded = await rosterService.onMembershipEvent(event({ channelId: 'channel-2' }));
    expect(recorded.value).toStrictEqual({ agentUsernames: ['tess', 'mira'], channelId: 'channel-2' });
  });
});
