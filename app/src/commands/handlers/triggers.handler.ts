import { Injectable } from '@nestjs/common';

import { AgentRegistry } from '@/agents/agents.registry.ts';
import { TriggersService } from '@/triggers/triggers.service.ts';

import { CommandHandler } from '../commands.handler.ts';
import { requireAgentName } from './argument.utils.ts';

import type { CommandInput, CommandResponse } from '../commands.types.ts';

/** §8.4 — every trigger the agent has not yet marked handled */
@Injectable()
export class TriggersHandler extends CommandHandler {
  readonly trigger = 'triggers';

  constructor(
    private readonly agentRegistry: AgentRegistry,
    private readonly triggersService: TriggersService
  ) {
    super();
  }

  async handle(input: CommandInput): Promise<CommandResponse> {
    const named = requireAgentName(this.agentRegistry, input.text, this.trigger);
    if (!named.success) {
      return named.error;
    }
    const agentUsername = named.value;
    const outstanding = await this.triggersService.listOutstanding(agentUsername);
    if (outstanding.length === 0) {
      return { audience: 'invoker', text: `No outstanding triggers for ${agentUsername}.` };
    }
    return {
      audience: 'invoker',
      text: [
        `Outstanding triggers for ${agentUsername}:`,
        ...outstanding.map((trigger) => `- ${trigger.id} (${trigger.status}) from ${trigger.source}`)
      ].join('\n')
    };
  }
}
