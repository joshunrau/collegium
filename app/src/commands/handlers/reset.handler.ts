import { Injectable } from '@nestjs/common';

import { AgentRegistry } from '@/agents/agents.registry.ts';
import { ConversationsService } from '@/conversations/conversations.service.ts';
import { EpisodesService } from '@/conversations/episodes/episodes.service.ts';

import { CommandHandler } from '../commands.handler.ts';
import { requireAgentName } from './argument.utils.ts';

import type { CommandInput, CommandResponse } from '../commands.types.ts';

/** §3.8 — context never reaches back past the most recent episode boundary */
@Injectable()
export class ResetHandler extends CommandHandler {
  readonly trigger = 'reset';

  constructor(
    private readonly agentRegistry: AgentRegistry,
    private readonly conversationsService: ConversationsService,
    private readonly episodesService: EpisodesService
  ) {
    super();
  }

  async handle(input: CommandInput): Promise<CommandResponse> {
    const named = requireAgentName(this.agentRegistry, input.text, this.trigger);
    if (!named.success) {
      return named.error;
    }
    const agentUsername = named.value;
    const latestPostId = await this.conversationsService.latestPostIdIn(input.channelId);
    if (latestPostId === undefined) {
      return { audience: 'invoker', text: 'Nothing here to reset.' };
    }
    await this.episodesService.mark(agentUsername, input.channelId, latestPostId);
    return {
      audience: 'channel',
      text: `🔄 Episode boundary set: ${agentUsername} will not read past this point.`
    };
  }
}
