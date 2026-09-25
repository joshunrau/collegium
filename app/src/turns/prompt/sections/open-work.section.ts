import { TASKS_TOOLSET_DEF } from '@collegium/core/toolsets';
import { Injectable } from '@nestjs/common';

import { AgentRegistry } from '@/agents/agents.registry.ts';
import { MomentFormatter } from '@/formatting/dates/moment.formatter.ts';
import { TextFormatter } from '@/formatting/text/text.formatter.ts';
import { TasksService } from '@/tasks/tasks.service.ts';
import { createPartyNamer, renderOpenUnitLine, wordingForAgent } from '@/tasks/tasks.utils.ts';
import { ToolRegistry } from '@/tools/tools.registry.ts';

import type { TurnPromptInput } from '../prompt.types.ts';

/** §3.15, A3 — stated beside the units, where a turn decides whether to hand its work on, since an open unit wakes nobody */
const NEXT_TURN =
  'Nothing starts another turn of yours here until a person posts, a colleague mentions you, or a trigger fires.';

/** §3.15 — the units this agent owes or is owed here, and where the other party to each stands; a unit is never truncated, the list is */
@Injectable()
export class OpenWorkSection {
  constructor(
    private readonly agentRegistry: AgentRegistry,
    private readonly momentFormatter: MomentFormatter,
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
      return this.textFormatter.formatParagraphs(['## Open work', `No work is open in this channel. ${NEXT_TURN}`], {});
    }
    const shown = this.agentRegistry.settingsFor(TASKS_TOOLSET_DEF, profile.username)?.shownInPrompt ?? units.length;
    const now = new Date();
    const wording = wordingForAgent(
      (moment) => this.momentFormatter.format(moment, now),
      createPartyNamer(this.agentRegistry),
      (ref) => this.toolRegistry.isGranted(profile, ref)
    );
    const lines = units.slice(0, shown).map((unit) => renderOpenUnitLine(unit, profile.username, now, wording));
    const remainder = units.length - lines.length;
    return this.textFormatter.formatParagraphs(
      [
        '## Open work',
        `Work handed over in this channel and still open, oldest first. A line that reads \`to\` a colleague is one you assigned and are waiting on; \`from\` a colleague, one you owe. In brackets is where that colleague stood as this turn began.${wording.isGranted('tasks::read') ? ' Read one in full with tasks__read:' : ''}`,
        '{listing}',
        ...(remainder > 0 ? [`…and ${remainder} more.`] : []),
        `A unit starts no turn by itself: its assignment or report does, by mentioning whoever must act next. ${NEXT_TURN}`
      ],
      { listing: this.textFormatter.formatBullets(lines) }
    );
  }
}
