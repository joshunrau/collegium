import { Injectable } from '@nestjs/common';

import { RosterService } from '@/channels/roster/roster.service.ts';
import { ChatGateway } from '@/chat/chat.gateway.ts';
import { TransportRegistry } from '@/chat/transports/transport.registry.ts';
import { LoggingService } from '@/logging/logging.service.ts';

import type { Announcement } from './announcing.types.ts';

/**
 * §7.5 — the system bot where it is present, and under the agent's own account in a DM, where
 * Mattermost fixes membership at creation and admits no third party. The DM case is recognised by
 * the post failing over a channel holding exactly one agent, rather than by asking the substrate
 * what kind of channel it is: the answer that matters is whether the notice landed.
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
    const posted = await this.chatGateway.postAsSystemIn(channelId, text);
    if (posted.success) {
      const { authorUsername, createdAt, postId } = posted.value;
      return {
        authorKind: 'system',
        authorUsername,
        createdAt,
        edit: (revised) => this.chatGateway.updateSystemPost(postId, { text: revised }),
        postId
      };
    }
    const [agent, ...alsoPresent] = this.rosterService.listAgentsIn(channelId);
    if (!agent || alsoPresent.length > 0) {
      this.loggingService.error(new Error(`failed to announce in ${channelId}: ${posted.error.message}`));
      return undefined;
    }
    const transport = this.transportRegistry.get(agent.username);
    const relayed = await transport.send({ channelId, text });
    if (!relayed.success) {
      this.loggingService.error(new Error(`failed to announce in ${channelId}: ${relayed.error.message}`));
      return undefined;
    }
    const { createdAt, postId } = relayed.value;
    return {
      authorKind: 'agent',
      authorUsername: agent.username,
      createdAt,
      edit: (revised) => transport.updatePost(postId, { text: revised }),
      postId
    };
  }
}
