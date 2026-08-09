import { Result } from '@collegium/core/utils';
import { Injectable } from '@nestjs/common';

import { AgentRegistry } from '@/agents/agents.registry.ts';
import type { AgentProfile } from '@/agents/agents.types.ts';
import type { ChatEvent, ChatFailure } from '@/chat/chat.types.ts';
import { TransportRegistry } from '@/chat/transports/transport.registry.ts';

import { ChannelsService } from '../channels.service.ts';

import type { TopologyViolation } from '../channels.types.ts';

/**
 * An in-memory cache of which agents sit in which channels, maintained by websocket events — never
 * polled — and reconciled against the API on boot, since changes during downtime are invisible to
 * the event stream (§3.11).
 */
@Injectable()
export class RosterService {
  private memberships = new Map<string, Set<string>>();

  constructor(
    private readonly agentRegistry: AgentRegistry,
    private readonly channelsService: ChannelsService,
    private readonly transportRegistry: TransportRegistry
  ) {}

  /** the §3.10 one-agent rule, asked of this module because only it knows membership */
  findRespondToAllViolation(): TopologyViolation | undefined {
    for (const channelId of this.channelsService.listRespondToAllChannelIds()) {
      const agentUsernames = [...(this.memberships.get(channelId) ?? [])];
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
    return this.memberships.get(channelId)?.has(agentUsername) ?? false;
  }

  /** every agent present in the channel — what the §4.5 guard counts against */
  listAgentsIn(channelId: string): readonly AgentProfile[] {
    return [...(this.memberships.get(channelId) ?? [])].flatMap((username) => this.agentRegistry.get(username) ?? []);
  }

  onMembershipEvent(event: ChatEvent.Membership): TopologyViolation | undefined {
    const members = this.memberships.get(event.channelId) ?? new Set<string>();
    if (event.kind === 'user_added_to_channel') {
      members.add(event.agentUsername);
      this.memberships.set(event.channelId, members);
    } else {
      members.delete(event.agentUsername);
    }
    return this.findRespondToAllViolation();
  }

  /**
   * Per agent, using that agent's own token — a privileged token would import membership from
   * channels the agent is not in (§3.11). Throws on a §3.10 violation, because reconcile runs at
   * boot and a topology the runtime would halt over must refuse to start instead.
   */
  async reconcile(): Promise<Result<void, ChatFailure>> {
    const memberships = new Map<string, Set<string>>();
    for (const profile of this.agentRegistry.list()) {
      const channels = await this.transportRegistry.get(profile.username).getChannelMemberships();
      if (!channels.success) {
        return channels;
      }
      for (const channelId of channels.value) {
        const members = memberships.get(channelId) ?? new Set<string>();
        members.add(profile.username);
        memberships.set(channelId, members);
      }
    }
    this.memberships = memberships;
    const violation = this.findRespondToAllViolation();
    if (violation) {
      throw new Error(
        `respond-to-all channel "${violation.channelId}" holds ${violation.agentUsernames.length} agents (${violation.agentUsernames.join(', ')}); it may hold at most one (§3.10)`
      );
    }
    return Result.ok();
  }
}
