import { Result } from '@collegium/core/utils';
import { Injectable } from '@nestjs/common';

import { AgentRegistry } from '@/agents/agents.registry.ts';
import type { AgentProfile } from '@/agents/agents.types.ts';
import type { ChatEvent, ChatFailure } from '@/chat/chat.types.ts';
import { TransportRegistry } from '@/chat/transports/transport.registry.ts';

import { ChannelsService } from '../channels.service.ts';
import { isAudienceWithin, renderChannelName } from './roster.utils.ts';

import type { ChannelRecord, ReachableChannel, TopologyViolation } from '../channels.types.ts';

/**
 * An in-memory cache of what each channel is and who sits in it, maintained by websocket events —
 * never polled — and reconciled against the API on boot, since changes during downtime are
 * invisible to the event stream (§3.11). Agents are the members the registry knows.
 */
@Injectable()
export class RosterService {
  private channels = new Map<string, ChannelRecord>();

  constructor(
    private readonly agentRegistry: AgentRegistry,
    private readonly channelsService: ChannelsService,
    private readonly transportRegistry: TransportRegistry
  ) {}

  /** the §3.10 one-agent rule, asked of this module because only it knows membership */
  findRespondToAllViolation(): TopologyViolation | undefined {
    for (const channelId of this.channelsService.listRespondToAllChannelIds()) {
      const agentUsernames = this.listAgentsIn(channelId).map((profile) => profile.username);
      if (agentUsernames.length > 1) {
        return { agentUsernames, channelId };
      }
    }
    return undefined;
  }

  /** other agents in this channel: excludes the caller, and the system bot is never an agent (§3.11) */
  getPeers(channelId: string, selfUsername: string): readonly AgentProfile[] {
    return this.listAgentsIn(channelId).filter((profile) => profile.username !== selfUsername);
  }

  /** §4.2 — trigger intake asks before recording work that would have no route to its agent */
  isAgentIn(agentUsername: string, channelId: string): boolean {
    return this.channels.get(channelId)?.memberUsernames.has(agentUsername) ?? false;
  }

  /** every agent present in the channel — what the §4.5 guard counts against */
  listAgentsIn(channelId: string): readonly AgentProfile[] {
    return [...(this.channels.get(channelId)?.memberUsernames ?? [])].flatMap((username) => {
      return this.agentRegistry.get(username) ?? [];
    });
  }

  /**
   * §3.8 — the channels a search from `channelId` may surface posts of: those the agent is in
   * whose audience contains everyone who can read `channelId`, so a result never widens an
   * audience. An unknown channel, or one the agent is not in, reaches nothing.
   */
  listReachableFrom(agentUsername: string, channelId: string): readonly ReachableChannel[] {
    const current = this.channels.get(channelId);
    if (!current?.memberUsernames.has(agentUsername)) {
      return [];
    }
    return [...this.channels]
      .filter(([, record]) => record.memberUsernames.has(agentUsername) && isAudienceWithin(current, record))
      .map(([id, record]) => ({ channelId: id, name: renderChannelName(record, agentUsername) }));
  }

  /** the channel as a human reading a cross-channel listing names it (§8.4); unknown where no agent is in it */
  nameOf(channelId: string, selfUsername: string): string | undefined {
    const record = this.channels.get(channelId);
    return record && renderChannelName(record, selfUsername);
  }

  /**
   * The agent's own arrival is the one moment the channel is described whole, since nothing
   * before it could see inside; every other movement edits the members already known.
   */
  async onMembershipEvent(event: ChatEvent.Membership): Promise<Result<TopologyViolation | undefined, ChatFailure>> {
    if (event.username === event.agentUsername && event.kind === 'user_added_to_channel') {
      const described = await this.transportRegistry.get(event.agentUsername).describeChannel(event.channelId);
      if (!described.success) {
        return described;
      }
      this.channels.set(event.channelId, {
        displayName: described.value.displayName,
        kind: described.value.kind,
        memberUsernames: new Set([...described.value.memberUsernames, event.agentUsername])
      });
      return Result.ok(this.findRespondToAllViolation());
    }
    const record = this.channels.get(event.channelId);
    if (record === undefined) {
      return Result.ok(undefined);
    }
    if (event.kind === 'user_added_to_channel') {
      record.memberUsernames.add(event.username);
    } else {
      record.memberUsernames.delete(event.username);
    }
    if (this.listAgentsIn(event.channelId).length === 0) {
      this.channels.delete(event.channelId);
    }
    return Result.ok(this.findRespondToAllViolation());
  }

  /**
   * Per agent, using that agent's own token — a privileged token would import membership from
   * channels the agent is not in (§3.11) — and each channel described once, by the first agent
   * found in it. Throws on a §3.10 violation, because reconcile runs at boot and a topology the
   * runtime would halt over must refuse to start instead.
   */
  async reconcile(): Promise<Result<void, ChatFailure>> {
    const channels = new Map<string, ChannelRecord>();
    for (const profile of this.agentRegistry.list()) {
      const transport = this.transportRegistry.get(profile.username);
      const memberships = await transport.getChannelMemberships();
      if (!memberships.success) {
        return memberships;
      }
      for (const channelId of memberships.value) {
        const known = channels.get(channelId);
        if (known !== undefined) {
          known.memberUsernames.add(profile.username);
          continue;
        }
        const described = await transport.describeChannel(channelId);
        if (!described.success) {
          return described;
        }
        channels.set(channelId, {
          displayName: described.value.displayName,
          kind: described.value.kind,
          memberUsernames: new Set([...described.value.memberUsernames, profile.username])
        });
      }
    }
    this.channels = channels;
    const violation = this.findRespondToAllViolation();
    if (violation) {
      throw new Error(
        `respond-to-all channel "${violation.channelId}" holds ${violation.agentUsernames.length} agents (${violation.agentUsernames.join(', ')}); it may hold at most one (§3.10)`
      );
    }
    return Result.ok();
  }
}
