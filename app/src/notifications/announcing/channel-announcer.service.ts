import { Result } from '@collegium/core/utils';
import { Injectable } from '@nestjs/common';

import type { AgentProfile } from '@/agents/agents.types.ts';
import { RosterService } from '@/channels/roster/roster.service.ts';
import { ChatGateway } from '@/chat/chat.gateway.ts';
import type { ChatFailure } from '@/chat/chat.types.ts';
import { TransportRegistry } from '@/chat/transports/transport.registry.ts';
import { LoggingService } from '@/logging/logging.service.ts';

import type { Announcement } from './announcing.types.ts';

/**
 * §7.5 — the system bot where it is present, and under the agent's own account in a DM, which the
 * roster knows the channel to be (§3.11): a DM the system bot could reach is still the agent's to
 * speak in (§3.2). Whichever speaks first, the other is the fallback, since the answer that matters
 * is whether the notice landed.
 */
@Injectable()
export class ChannelAnnouncer {
  constructor(
    private readonly chatGateway: ChatGateway,
    private readonly loggingService: LoggingService,
    private readonly rosterService: RosterService,
    private readonly transportRegistry: TransportRegistry
  ) {}

  /** the notice as it landed; undefined when no channel could be told, which is logged here */
  async announce(channelId: string, text: string): Promise<Announcement | undefined> {
    const agent = this.soleAgentIn(channelId);
    const asAgent = agent === undefined ? [] : [() => this.announceAsAgent(agent, channelId, text)];
    const asSystem = () => this.announceAsSystem(channelId, text);
    const speakers =
      agent !== undefined && this.rosterService.isDirectMessage(channelId)
        ? [...asAgent, asSystem]
        : [asSystem, ...asAgent];
    let failure: ChatFailure | undefined;
    for (const speak of speakers) {
      const announced = await speak();
      if (announced.success) {
        return announced.value;
      }
      failure = announced.error;
    }
    this.loggingService.error(new Error(`failed to announce in ${channelId}: ${failure?.message}`));
    return undefined;
  }

  private async announceAsAgent(
    agent: AgentProfile,
    channelId: string,
    text: string
  ): Promise<Result<Announcement, ChatFailure>> {
    const transport = this.transportRegistry.get(agent.username);
    const relayed = await transport.send({ channelId, text });
    if (!relayed.success) {
      return relayed;
    }
    const { createdAt, postId } = relayed.value;
    return Result.ok({
      authorKind: 'agent',
      authorUsername: agent.username,
      createdAt,
      edit: (revised) => transport.updatePost(postId, { text: revised }),
      postId
    });
  }

  private async announceAsSystem(channelId: string, text: string): Promise<Result<Announcement, ChatFailure>> {
    const posted = await this.chatGateway.postAsSystemIn(channelId, text);
    if (!posted.success) {
      return posted;
    }
    const { authorUsername, createdAt, postId } = posted.value;
    return Result.ok({
      authorKind: 'system',
      authorUsername,
      createdAt,
      edit: (revised) => this.chatGateway.updateSystemPost(postId, { text: revised }),
      postId
    });
  }

  /** the one agent that may speak for the framework in a channel; two present is nobody's channel to speak in */
  private soleAgentIn(channelId: string): AgentProfile | undefined {
    const [agent, ...alsoPresent] = this.rosterService.listAgentsIn(channelId);
    return alsoPresent.length === 0 ? agent : undefined;
  }
}
