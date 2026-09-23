import { Injectable } from '@nestjs/common';

import { TextFormatter } from '@/formatting/text/text.formatter.ts';
import { MemoryService } from '@/memory/memory.service.ts';

import type { TurnPromptInput } from '../prompt.types.ts';

@Injectable()
export class MemoriesSection {
  constructor(
    private readonly memoryService: MemoryService,
    private readonly textFormatter: TextFormatter
  ) {}

  async render({ profile }: TurnPromptInput): Promise<string | undefined> {
    const memories = await this.memoryService.list(profile.username);
    if (memories.length === 0) {
      return undefined;
    }
    return this.textFormatter.formatParagraphs(
      [
        '## Memories',
        'Your memories, by description, written by you in earlier turns. memory__read returns one body and spends no attempt; read one whose description matches the work in front of you:',
        '{listing}'
      ],
      {
        listing: this.textFormatter.formatBullets(
          memories.map((memory) => `[${memory.reference}] ${memory.description}`)
        )
      }
    );
  }
}
