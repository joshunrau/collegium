import { Injectable } from '@nestjs/common';

import { AgentRegistry } from '@/agents/agents.registry.ts';
import { TransportRegistry } from '@/chat/transports/transport.registry.ts';
import { LoggingService } from '@/logging/logging.service.ts';

import { ConversationsService } from '../conversations.service.ts';
import { PinsService } from '../pins/pins.service.ts';

/**
 * §8.2 — posts made while the process was down are absent from the store. Each channel is
 * backfilled from its last recorded post id forward, per agent using that agent's own token —
 * never a privileged one, or the framework would import posts from channels the agent has no
 * membership in and write them into a store the agent reads from. Backfilled posts are recorded
 * and context-eligible but never trigger a turn: they are history, not missed requests. Each
 * channel's pins are read afresh, since a pin or an edit made while the process was down is no post.
 */
@Injectable()
export class BackfillService {
  constructor(
    private readonly agentRegistry: AgentRegistry,
    private readonly conversationsService: ConversationsService,
    private readonly loggingService: LoggingService,
    private readonly pinsService: PinsService,
    private readonly transportRegistry: TransportRegistry
  ) {}

  async run(): Promise<void> {
    for (const profile of this.agentRegistry.list()) {
      const transport = this.transportRegistry.get(profile.username);
      const memberships = await transport.getChannelMemberships();
      if (!memberships.success) {
        this.loggingService.error(
          new Error(`backfill skipped for "${profile.username}": ${memberships.error.message}`)
        );
        continue;
      }
      for (const channelId of memberships.value) {
        const since = await this.conversationsService.latestPostIdIn(channelId);
        const posts = await transport.postsSince(channelId, since);
        if (!posts.success) {
          this.loggingService.error(
            new Error(`backfill skipped for channel "${channelId}" of "${profile.username}": ${posts.error.message}`)
          );
          continue;
        }
        for (const post of posts.value) {
          await this.conversationsService.record(post);
        }
        const pins = await this.pinsService.reconcile(transport, channelId);
        if (!pins.success) {
          this.loggingService.error(
            new Error(`pins not read for channel "${channelId}" of "${profile.username}": ${pins.error.message}`)
          );
        }
      }
    }
  }
}
