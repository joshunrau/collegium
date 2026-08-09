import { Injectable } from '@nestjs/common';

import { AgentRegistry } from '@/agents/agents.registry.ts';
import { ContextAssembler } from '@/turns/context/context.assembler.ts';

import { renderUsage } from '../commands.definitions.ts';
import { CommandHandler } from '../commands.handler.ts';
import { requireAgentProfile } from './argument.utils.ts';
import { renderPromptResponse } from './prompt.utils.ts';

import type { CommandInput, CommandResponse } from '../commands.types.ts';

/** §8.4 — the prompt an agent is actually given, assembled the way a turn assembles it */
@Injectable()
export class PromptHandler extends CommandHandler {
  readonly trigger = 'prompt';

  constructor(
    private readonly agentRegistry: AgentRegistry,
    private readonly contextAssembler: ContextAssembler
  ) {
    super();
  }

  async handle(input: CommandInput): Promise<CommandResponse> {
    const [firstToken = '', ...rest] = input.text.trim().split(/\s+/u);
    if (rest.length > 0) {
      return { audience: 'invoker', text: renderUsage(this.trigger) };
    }
    const named = requireAgentProfile(this.agentRegistry, firstToken, this.trigger);
    if (!named.success) {
      return named.error;
    }
    const profile = named.value;
    const prompt = await this.contextAssembler.renderPromptFor({ channelId: input.channelId, profile });
    return { audience: 'invoker', text: renderPromptResponse(profile.username, prompt) };
  }
}
