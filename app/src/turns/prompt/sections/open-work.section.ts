import { TASKS_TOOLSET_DEF } from '@collegium/core/toolsets';
import { Injectable } from '@nestjs/common';

import { AgentRegistry } from '@/agents/agents.registry.ts';
import { TextFormatter } from '@/formatting/text/text.formatter.ts';
import { TasksService } from '@/tasks/tasks.service.ts';
import { renderOpenUnitLine } from '@/tasks/tasks.utils.ts';
import { ToolRegistry } from '@/tools/tools.registry.ts';

import type { TurnPromptInput } from '../prompt.types.ts';

/** §3.15 — the units this agent owes or is owed here; a unit is never truncated, the list is */
@Injectable()
export class OpenWorkSection {
  constructor(
    private readonly agentRegistry: AgentRegistry,
    private readonly tasksService: TasksService,
    private readonly textFormatter: TextFormatter,
    private readonly toolRegistry: ToolRegistry
  ) {}

  async render({ channelId, profile }: TurnPromptInput): Promise<string | undefined> {
    const holdsTasks = this.toolRegistry.listFor(profile).some(({ id: [namespace] }) => namespace === 'tasks');
    if (!holdsTasks) {
      return undefined;
    }
    const units = await this.tasksService.listOpenFor({ agentUsername: profile.username, channelId });
    // §3.15 — an absent section would read three ways; a stated zero reads one
    if (units.length === 0) {
      return this.textFormatter.formatParagraphs(['## Open work', 'No work is open in this channel.'], {});
    }
    const shown = this.agentRegistry.settingsFor(TASKS_TOOLSET_DEF, profile.username)?.shownInPrompt ?? units.length;
    const now = new Date();
    const lines = units.slice(0, shown).map((unit) => renderOpenUnitLine(unit, profile.username, now));
    const remainder = units.length - lines.length;
    return this.textFormatter.formatParagraphs(
      [
        '## Open work',
        'Work handed over in this channel and still open, oldest first. A line marked `to @name` is one you assigned and are waiting on; `from @name` is one you owe. Read one in full with tasks__read:',
        '{listing}',
        ...(remainder > 0 ? [`…and ${remainder} more.`] : [])
      ],
      { listing: this.textFormatter.formatBullets(lines) }
    );
  }
}
