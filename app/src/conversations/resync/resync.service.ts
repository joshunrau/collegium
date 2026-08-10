import { Injectable } from '@nestjs/common';

import type { AgentProfile } from '@/agents/agents.types.ts';
import { TransportRegistry } from '@/chat/transports/transport.registry.ts';
import { LoggingService } from '@/logging/logging.service.ts';

import { ConversationsService } from '../conversations.service.ts';

import type { ObservedPost } from '../conversations.types.ts';

/**
 * Backfill's sibling, for a different occasion. Backfill imports what a *restart* missed and treats
 * it as history (§8.2); this imports what a live process missed while its socket was down, which is
 * not history — a mention posted during a network blip was addressed to an agent that was running.
 *
 * The socket says only that events were dropped, never which, so every channel the agent belongs to
 * is re-read from its last recorded post forward. Recording is idempotent on post id, so re-reading
 * a channel that lost nothing costs one request and changes nothing.
 */
@Injectable()
export class ResyncService {
  constructor(
    private readonly conversationsService: ConversationsService,
    private readonly loggingService: LoggingService,
    private readonly transportRegistry: TransportRegistry
  ) {}

  /** every post this agent never saw, recorded and handed back in arrival order */
  async recover(profile: AgentProfile): Promise<ObservedPost[]> {
    const transport = this.transportRegistry.get(profile.username);
    const memberships = await transport.getChannelMemberships();
    if (!memberships.success) {
      this.loggingService.error(new Error(`resync skipped for "${profile.username}": ${memberships.error.message}`));
      return [];
    }
    const recovered: ObservedPost[] = [];
    for (const channelId of memberships.value) {
      const since = await this.conversationsService.latestPostIdIn(channelId);
      const posts = await transport.postsSince(channelId, since);
      if (!posts.success) {
        this.loggingService.error(
          new Error(`resync skipped for channel "${channelId}" of "${profile.username}": ${posts.error.message}`)
        );
        continue;
      }
      for (const post of posts.value) {
        if (await this.conversationsService.record(post)) {
          recovered.push(post);
        }
      }
    }
    return recovered;
  }
}
