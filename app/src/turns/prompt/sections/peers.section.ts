import { Injectable } from '@nestjs/common';

import type { AgentProfile } from '@/agents/agents.types.ts';
import { RosterService } from '@/channels/roster/roster.service.ts';
import { WindowService } from '@/conversations/window/window.service.ts';
import { TextFormatter } from '@/formatting/text/text.formatter.ts';
import { ToolRegistry } from '@/tools/tools.registry.ts';

import type { TurnPromptInput } from '../prompt.types.ts';

/** §3.11 — enough handles for the people a piece of work involves, never a busy channel's whole membership */
const PEOPLE_LISTED = 5;

/** §3.11 — who else is in this channel: the people who posted here, then the colleagues present */
@Injectable()
export class PeersSection {
  constructor(
    private readonly rosterService: RosterService,
    private readonly textFormatter: TextFormatter,
    private readonly toolRegistry: ToolRegistry,
    private readonly windowService: WindowService
  ) {}

  async render({ channelId, profile }: TurnPromptInput): Promise<string | undefined> {
    const people = await this.windowService.listRecentPeople({
      agentUsername: profile.username,
      channelId,
      take: PEOPLE_LISTED
    });
    const parts = [this.renderPeople(people), this.renderPeers(channelId, profile)].filter(
      (part) => part !== undefined
    );
    return parts.length === 0 ? undefined : this.textFormatter.formatParagraphs(parts, {});
  }

  private renderPeerLine(peer: AgentProfile): string {
    const namespaces = this.toolRegistry.listGrantedNamespacesFor(peer);
    const toolsets = namespaces.length === 0 ? 'none' : namespaces.join(', ');
    return `${peer.displayName} (@${peer.username}) — ${peer.expertise} (toolsets: ${toolsets})`;
  }

  private renderPeers(channelId: string, profile: AgentProfile): string | undefined {
    const peers = this.rosterService.getPeers(channelId, profile.username);
    if (peers.length === 0) {
      return undefined;
    }
    return this.textFormatter.formatParagraphs(
      [
        '## Peers',
        'Colleagues in this channel and what each is asked about. The toolsets say what each can do, not what should be handed over:',
        '{listing}'
      ],
      {
        listing: this.textFormatter.formatBullets(peers.map((peer) => this.renderPeerLine(peer)))
      }
    );
  }

  private renderPeople(people: readonly string[]): string | undefined {
    if (people.length === 0) {
      return undefined;
    }
    return this.textFormatter.formatParagraphs(
      ['## People here', 'The people who posted in this channel most recently, latest first: {handles}'],
      { handles: people.map((username) => `@${username}`).join(', ') }
    );
  }
}
