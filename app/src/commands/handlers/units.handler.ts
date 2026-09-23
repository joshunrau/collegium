import { Injectable } from '@nestjs/common';

import { AgentRegistry } from '@/agents/agents.registry.ts';
import { MomentFormatter } from '@/formatting/dates/moment.formatter.ts';
import { TasksService } from '@/tasks/tasks.service.ts';
import { createPartyNamer, renderTaskRefusal, wordingForPerson } from '@/tasks/tasks.utils.ts';

import { renderUsage } from '../commands.definitions.ts';
import { CommandHandler } from '../commands.handler.ts';
import { UnitsReportService } from '../reports/units-report.service.ts';
import { requireAgentName } from './argument.utils.ts';
import { renderUnitsListing } from './units.utils.ts';

import type { CommandInput, CommandResponse } from '../commands.types.ts';

/** §8.4 — the human lever on delegated work: see it, and cancel a unit whose creator will never reach it (§3.15) */
@Injectable()
export class UnitsHandler extends CommandHandler {
  readonly trigger = 'units';

  constructor(
    private readonly agentRegistry: AgentRegistry,
    private readonly momentFormatter: MomentFormatter,
    private readonly tasksService: TasksService,
    private readonly unitsReportService: UnitsReportService
  ) {
    super();
  }

  async handle(input: CommandInput): Promise<CommandResponse> {
    const [firstToken = '', action, reference] = input.text.trim().split(/\s+/u);
    const named = requireAgentName(this.agentRegistry, firstToken, this.trigger);
    if (!named.success) {
      return named.error;
    }
    const agentUsername = named.value;
    const now = new Date();
    const wording = wordingForPerson(
      agentUsername,
      (moment) => this.momentFormatter.format(moment, now),
      createPartyNamer(this.agentRegistry)
    );
    if (action === 'cancel' && reference !== undefined) {
      const prepared = await this.tasksService.prepareCancelOnHumanAuthority({
        agentUsername,
        byUsername: input.username,
        channelId: input.channelId,
        reference
      });
      if (!prepared.success) {
        return { audience: 'invoker', text: `${renderTaskRefusal(prepared.error, wording)}.` };
      }
      // §3.15 — the post comes first: the row moves only once the announcement has landed
      return {
        audience: 'channel',
        onAnnounced: (postId) => this.tasksService.commitTransition(prepared.value.prepared, postId),
        text: prepared.value.text
      };
    }
    if (action !== undefined) {
      return { audience: 'invoker', text: renderUsage(this.trigger) };
    }
    const report = await this.unitsReportService.read(agentUsername, input.channelId);
    return { audience: 'invoker', text: renderUnitsListing(agentUsername, report, now, wording) };
  }
}
