import { Injectable } from '@nestjs/common';

import { AgentRegistry } from '@/agents/agents.registry.ts';
import { TasksService } from '@/tasks/tasks.service.ts';
import { renderTaskRefusal } from '@/tasks/tasks.utils.ts';

import { renderUsage } from '../commands.definitions.ts';
import { CommandHandler } from '../commands.handler.ts';
import { requireAgentName } from './argument.utils.ts';
import { renderUnitsListing } from './units.utils.ts';

import type { CommandInput, CommandResponse } from '../commands.types.ts';

/** §8.4 — the human lever on delegated work: see it, and cancel a unit whose creator will never reach it (§3.15) */
@Injectable()
export class UnitsHandler extends CommandHandler {
  readonly trigger = 'units';

  constructor(
    private readonly agentRegistry: AgentRegistry,
    private readonly tasksService: TasksService
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
    if (action === 'cancel' && reference !== undefined) {
      const prepared = await this.tasksService.prepareCancelOnHumanAuthority({
        agentUsername,
        byUsername: input.username,
        channelId: input.channelId,
        reference
      });
      if (!prepared.success) {
        return { audience: 'invoker', text: `${renderTaskRefusal(prepared.error)}.` };
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
    const units = await this.tasksService.listOpenFor({ agentUsername, channelId: input.channelId });
    if (units.length === 0) {
      return { audience: 'invoker', text: `${agentUsername} has no open work in this channel.` };
    }
    return { audience: 'invoker', text: renderUnitsListing(agentUsername, units, new Date()) };
  }
}
