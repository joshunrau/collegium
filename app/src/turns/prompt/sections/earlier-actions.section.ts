import { Injectable } from '@nestjs/common';

import { WindowService } from '@/conversations/window/window.service.ts';
import { TextFormatter } from '@/formatting/text/text.formatter.ts';

import { RECENT_ACTION_LINES } from '../prompt.constants.ts';
import { collapseRepeatedLines } from '../prompt.utils.ts';

import type { TurnPromptInput } from '../prompt.types.ts';

@Injectable()
export class EarlierActionsSection {
  constructor(
    private readonly textFormatter: TextFormatter,
    private readonly windowService: WindowService
  ) {}

  async render({ channelId, profile, windowReachesBackTo }: TurnPromptInput): Promise<string | undefined> {
    if (windowReachesBackTo === undefined) {
      return undefined;
    }
    const lines = await this.windowService.readRecentActions({
      agentUsername: profile.username,
      before: windowReachesBackTo,
      channelId,
      take: RECENT_ACTION_LINES
    });
    if (lines.length === 0) {
      return undefined;
    }
    return this.textFormatter.formatParagraphs(
      [
        '## Earlier in this channel',
        'What you did here before your context reaches back to, newest first:',
        '{listing}'
      ],
      {
        listing: this.textFormatter.formatBullets(collapseRepeatedLines(lines))
      }
    );
  }
}
