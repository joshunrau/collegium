import { Injectable } from '@nestjs/common';

import { AgentRegistry } from '@/agents/agents.registry.ts';
import { SkillsService } from '@/skills/skills.service.ts';
import { ToolRegistry } from '@/tools/tools.registry.ts';
import { ContextAssembler } from '@/turns/context/context.assembler.ts';

import { renderUsage } from '../commands.definitions.ts';
import { CommandHandler } from '../commands.handler.ts';
import { requireAgentProfile } from './argument.utils.ts';
import { renderInspectResponse } from './inspect.utils.ts';

import type { CommandInput, CommandResponse } from '../commands.types.ts';

/** §8.4 — what an agent is and what it is given: its model, effective tools and skills, and the prompt a turn here would assemble */
@Injectable()
export class InspectHandler extends CommandHandler {
  readonly trigger = 'inspect';

  constructor(
    private readonly agentRegistry: AgentRegistry,
    private readonly contextAssembler: ContextAssembler,
    private readonly skillsService: SkillsService,
    private readonly toolRegistry: ToolRegistry
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
    return {
      audience: 'invoker',
      text: renderInspectResponse({
        profile,
        prompt,
        skills: this.skillsService.listFor(profile),
        tools: this.toolRegistry.listFor(profile)
      })
    };
  }
}
