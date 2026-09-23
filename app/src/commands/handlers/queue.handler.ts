import { Injectable } from '@nestjs/common';

import { AgentRegistry } from '@/agents/agents.registry.ts';
import { ChannelLockService } from '@/channels/locks/channel-lock.service.ts';
import { ConversationsService } from '@/conversations/conversations.service.ts';
import { DateFormatter } from '@/formatting/dates/date.formatter.ts';
import { QueueService } from '@/queue/queue.service.ts';
import { TurnsService } from '@/turns/turns.service.ts';

import { renderUsage } from '../commands.definitions.ts';
import { CommandHandler } from '../commands.handler.ts';
import { requireAgentName } from './argument.utils.ts';
import { renderLaneReport } from './queue.utils.ts';

import type { CommandInput, CommandResponse } from '../commands.types.ts';
import type { LaneHold, QueueBacklog } from './queue.utils.ts';

/** §8.4 — whether a turn holds the lane, what waits behind it, and the one way to throw a standing entry away */
@Injectable()
export class QueueHandler extends CommandHandler {
  readonly trigger = 'queue';

  constructor(
    private readonly agentRegistry: AgentRegistry,
    private readonly channelLockService: ChannelLockService,
    private readonly conversationsService: ConversationsService,
    private readonly dateFormatter: DateFormatter,
    private readonly queueService: QueueService,
    private readonly turnsService: TurnsService
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
    const [hold, backlog] = await Promise.all([
      this.readLaneHold(agentUsername, input.channelId),
      this.readBacklog(agentUsername, input.channelId)
    ]);
    return { audience: 'invoker', text: renderLaneReport(agentUsername, hold, backlog) };
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

  private async readBacklog(agentUsername: string, channelId: string): Promise<QueueBacklog | undefined> {
    const entry = await this.queueService.peek(agentUsername, channelId);
    if (!entry) {
      return undefined;
    }
    const { earliestUnprocessedPostId } = entry;
    return {
      earliestUnprocessedPostId,
      summary: await this.conversationsService.summarizeBacklog(channelId, earliestUnprocessedPostId)
    };
  }

  private async readLaneHold(agentUsername: string, channelId: string): Promise<LaneHold | undefined> {
    const heldSince = this.channelLockService.heldSince(agentUsername, channelId);
    if (heldSince === undefined) {
      return undefined;
    }
    return {
      heldForMs: Date.now() - heldSince.getTime(),
      heldSince: this.dateFormatter.format(heldSince),
      turn: await this.turnsService.findRunningIn(agentUsername, channelId)
    };
  }
}
