import { Injectable } from '@nestjs/common';

import { AgentRegistry } from '@/agents/agents.registry.ts';
import { ConversationsService } from '@/conversations/conversations.service.ts';
import { QueueService } from '@/queue/queue.service.ts';

import { renderUsage } from '../commands.definitions.ts';
import { CommandHandler } from '../commands.handler.ts';
import { requireAgentName } from './argument.utils.ts';

import type { CommandInput, CommandResponse } from '../commands.types.ts';

const SNIPPET_LIMIT_CHARS = 80;

/** §8.4 — pending depth and the oldest unprocessed post, and the one way to throw a standing entry away */
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
    const [firstToken = '', action] = input.text.trim().split(/\s+/u);
    const named = requireAgentName(this.agentRegistry, firstToken, this.trigger);
    if (!named.success) {
      return named.error;
    }
    const agentUsername = named.value;
    if (action !== undefined && action !== 'clear') {
      return { audience: 'invoker', text: renderUsage(this.trigger) };
    }
    if (action === 'clear') {
      return this.clear(agentUsername, input.channelId);
    }
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

  /** §3.2 — discarding work is attributable, so the channel hears it from the system bot */
  private async clear(agentUsername: string, channelId: string): Promise<CommandResponse> {
    const discarded = await this.queueService.discard(agentUsername, channelId);
    if (!discarded) {
      return { audience: 'invoker', text: `Queue for ${agentUsername} in this channel: empty. Nothing discarded.` };
    }
    return {
      audience: 'channel',
      text: `🗑️ Queued work discarded: ${agentUsername} will not run what was waiting here.`
    };
  }
}
