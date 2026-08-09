import { Injectable } from '@nestjs/common';

import { AgentRegistry } from '@/agents/agents.registry.ts';
import { ConversationsService } from '@/conversations/conversations.service.ts';
import { QueueService } from '@/queue/queue.service.ts';

import { CommandHandler } from '../commands.handler.ts';
import { requireAgentName } from './argument.utils.ts';

import type { CommandInput, CommandResponse } from '../commands.types.ts';

const SNIPPET_LIMIT_CHARS = 80;

/** §8.4 — pending depth and the oldest unprocessed post, for the human deciding whether to wait */
@Injectable()
export class QueueHandler extends CommandHandler {
  readonly trigger = 'queue';

  constructor(
    private readonly agentRegistry: AgentRegistry,
    private readonly conversationsService: ConversationsService,
    private readonly queueService: QueueService
  ) {
    super();
  }

  async handle(input: CommandInput): Promise<CommandResponse> {
    const named = requireAgentName(this.agentRegistry, input.text, this.trigger);
    if (!named.success) {
      return named.error;
    }
    const agentUsername = named.value;
    const entry = await this.queueService.peek(agentUsername, input.channelId);
    if (!entry) {
      return { audience: 'invoker', text: `Queue for ${agentUsername} in this channel: empty.` };
    }
    const backlog = await this.conversationsService.summarizeBacklog(input.channelId, entry.earliestUnprocessedPostId);
    const snippet = backlog === undefined ? '' : ` — "${backlog.message.slice(0, SNIPPET_LIMIT_CHARS)}"`;
    const depth = backlog === undefined ? 'an unknown number of' : backlog.pendingCount;
    return {
      audience: 'invoker',
      text: `Queue for ${agentUsername}: ${depth} post(s) pending; oldest unprocessed is ${entry.earliestUnprocessedPostId}${snippet}`
    };
  }
}
