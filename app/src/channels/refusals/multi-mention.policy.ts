import { Injectable } from '@nestjs/common';

import { AgentRegistry } from '@/agents/agents.registry.ts';
import { extractMentionedUsernames, stripMentionsOf } from '@/utils/mention.utils.ts';

import { RosterService } from '../roster/roster.service.ts';

type AddressablePost = { authorUsername: string; channelId: string; mentionedUsernames: readonly string[] };

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

  /** the peers a post addresses: agents present in the channel, other than the author — naming itself adds nothing */
  addresseesOf(post: AddressablePost): string[] {
    return this.rosterService
      .listAgentsIn(post.channelId)
      .filter((agent) => agent.username !== post.authorUsername)
      .filter((agent) => post.mentionedUsernames.includes(agent.username))
      .map((agent) => agent.username);
  }

  /**
   * §5.2 — the colleague a post a turn said addresses, if any: the one rule both the hold a running
   * turn keeps and the hold a restart recomputes (§7.3) read, so the two cannot disagree
   */
  findAddressee(post: { authorUsername: string; channelId: string; message: string }): string | undefined {
    const [addressee] = this.addresseesOf({ ...post, mentionedUsernames: extractMentionedUsernames(post.message) });
    return addressee;
  }

  refuses(post: AddressablePost): boolean {
    return this.addresseesOf(post).length >= 2;
  }

  /** §4.5 — a turn addresses one peer; a later post of the same turn naming a different one is refused */
  refusesSecondAddressee(post: AddressablePost, alreadyAddressed: string | undefined): boolean {
    return alreadyAddressed !== undefined && this.addresseesOf(post).some((peer) => peer !== alreadyAddressed);
  }

  /** status text never addresses anyone (§4.5) — an agent mention loses its @ before posting */
  stripAgentMentions(text: string): string {
    return this.stripAgentMentionsExcept(text, undefined);
  }

  /** §4.5 — a post addresses at most the one peer it is for: every other agent it names loses its @ */
  stripAgentMentionsExcept(text: string, addressee: string | undefined): string {
    return stripMentionsOf(
      text,
      this.agentRegistry
        .list()
        .map((profile) => profile.username)
        .filter((username) => username !== addressee)
    );
  }
}
