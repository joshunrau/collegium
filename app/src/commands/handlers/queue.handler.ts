import { Injectable } from '@nestjs/common';

import { AgentRegistry } from '@/agents/agents.registry.ts';
import { QueueService } from '@/queue/queue.service.ts';

import { renderUsage } from '../commands.definitions.ts';
import { CommandHandler } from '../commands.handler.ts';
import { LaneReportService } from '../reports/lane-report.service.ts';
import { requireAgentName } from './argument.utils.ts';
import { renderLaneReport } from './queue.utils.ts';

import type { CommandInput, CommandResponse } from '../commands.types.ts';

/** §8.4 — whether a turn holds the lane, what waits behind it, and the one way to throw a standing entry away */
@Injectable()
export class QueueHandler extends CommandHandler {
  readonly trigger = 'queue';

  constructor(
    private readonly agentRegistry: AgentRegistry,
    private readonly laneReportService: LaneReportService,
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
    return {
      audience: 'invoker',
      text: renderLaneReport(agentUsername, await this.laneReportService.read(agentUsername, input.channelId))
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
      text: `🗑️ Queued work discarded: ${this.agentRegistry.displayNameOf(agentUsername)} will not run what was waiting here.`
    };
  }
}
