import { Injectable } from '@nestjs/common';

import { AgentRegistry } from '@/agents/agents.registry.ts';
import { stripMentionsOf } from '@/utils/mention.utils.ts';

import { RosterService } from '../roster/roster.service.ts';

/**
 * §4.5 — a post addressing two or more agents present in the channel is refused, because two
 * concurrent turns on one task is the harm and this rule is what pins delegation width at one.
 * Mentions of absent agents are inert text, so a DM can never trip it.
 */
@Injectable()
export class MultiMentionPolicy {
  constructor(
    private readonly agentRegistry: AgentRegistry,
    private readonly rosterService: RosterService
  ) {}

  /** counts agents present in the channel beyond the author — an author naming itself adds nothing */
  refuses(post: { authorUsername: string; channelId: string; mentionedUsernames: readonly string[] }): boolean {
    const addressed = this.rosterService
      .listAgentsIn(post.channelId)
      .filter((agent) => agent.username !== post.authorUsername)
      .filter((agent) => post.mentionedUsernames.includes(agent.username));
    return addressed.length >= 2;
  }

  /** status text never addresses anyone (§4.5) — an agent mention loses its @ before posting */
  stripAgentMentions(text: string): string {
    return stripMentionsOf(
      text,
      this.agentRegistry.list().map((profile) => profile.username)
    );
  }
}
