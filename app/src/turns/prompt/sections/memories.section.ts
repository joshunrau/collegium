import { MEMORY_TOOLSET_DEF } from '@collegium/core/toolsets';
import { Injectable } from '@nestjs/common';

import { AgentRegistry } from '@/agents/agents.registry.ts';
import { TextFormatter } from '@/formatting/text/text.formatter.ts';
import { MemoryService } from '@/memory/memory.service.ts';

import { formatCount } from '../prompt.utils.ts';

import type { TurnPromptInput } from '../prompt.types.ts';

@Injectable()
export class MemoriesSection {
  constructor(
    private readonly agentRegistry: AgentRegistry,
    private readonly memoryService: MemoryService,
    private readonly textFormatter: TextFormatter
  ) {}

  async render({ profile }: TurnPromptInput): Promise<string | undefined> {
    const caps = this.agentRegistry.settingsFor(MEMORY_TOOLSET_DEF, profile.username);
    if (caps === undefined) {
      return undefined;
    }
    const memories = await this.memoryService.list(profile.username);
    if (memories.length === 0) {
      return undefined;
    }
    return this.textFormatter.formatParagraphs(
      [
        '## Memories',
        'Your memories ({memoryCount} of at most {maxEntries}), by description, written by you in earlier turns. memory__read returns one body and spends no attempt; read one whose description matches the work in front of you:',
        '{listing}'
      ],
      {
        listing: this.textFormatter.formatBullets(
          memories.map((memory) => `[${memory.reference}] ${memory.description}`)
        ),
        maxEntries: formatCount(caps.maxEntries),
        memoryCount: formatCount(memories.length)
      }
    );
  }
}
