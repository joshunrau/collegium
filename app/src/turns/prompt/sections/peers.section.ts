import { Injectable } from '@nestjs/common';

import type { AgentProfile } from '@/agents/agents.types.ts';
import { RosterService } from '@/channels/roster/roster.service.ts';
import { TextFormatter } from '@/formatting/text/text.formatter.ts';
import { ToolRegistry } from '@/tools/tools.registry.ts';

import type { TurnPromptInput } from '../prompt.types.ts';

@Injectable()
export class PeersSection {
  constructor(
    private readonly rosterService: RosterService,
    private readonly textFormatter: TextFormatter,
    private readonly toolRegistry: ToolRegistry
  ) {}

  render({ channelId, profile }: TurnPromptInput): string | undefined {
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

  private renderPeerLine(peer: AgentProfile): string {
    const namespaces = this.toolRegistry.listGrantedNamespacesFor(peer);
    const toolsets = namespaces.length === 0 ? 'none' : namespaces.join(', ');
    return `${peer.displayName} (@${peer.username}) — ${peer.expertise} (toolsets: ${toolsets})`;
  }
}
