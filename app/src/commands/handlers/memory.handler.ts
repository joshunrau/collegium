import { Injectable } from '@nestjs/common';

import { AgentRegistry } from '@/agents/agents.registry.ts';
import { MemoryService } from '@/memory/memory.service.ts';

import { renderUsage } from '../commands.definitions.ts';
import { CommandHandler } from '../commands.handler.ts';
import { requireAgentName } from './argument.utils.ts';

import type { CommandInput, CommandResponse } from '../commands.types.ts';

/** §8.4 — inspect and prune an agent's memories from the channel, not a SQL console */
@Injectable()
export class MemoryHandler extends CommandHandler {
  readonly trigger = 'memory';

  constructor(
    private readonly agentRegistry: AgentRegistry,
    private readonly memoryService: MemoryService
  ) {
    super();
  }

  async handle(input: CommandInput): Promise<CommandResponse> {
    const [firstToken = '', action, memoryId] = input.text.trim().split(/\s+/u);
    const named = requireAgentName(this.agentRegistry, firstToken, this.trigger);
    if (!named.success) {
      return named.error;
    }
    const agentUsername = named.value;
    if (action === 'prune' && memoryId !== undefined) {
      const deleted = await this.memoryService.delete(agentUsername, memoryId);
      return {
        audience: 'invoker',
        text: deleted.success ? `Deleted memory ${memoryId}.` : `No memory ${memoryId} for ${agentUsername}.`
      };
    }
    if (action !== undefined) {
      return { audience: 'invoker', text: renderUsage(this.trigger) };
    }
    const entries = await this.memoryService.list(agentUsername);
    if (entries.length === 0) {
      return { audience: 'invoker', text: `${agentUsername} has no memories.` };
    }
    return {
      audience: 'invoker',
      text: [`Memories for ${agentUsername}:`, ...entries.map((entry) => `- ${entry.id}: ${entry.description}`)].join(
        '\n'
      )
    };
  }
}
