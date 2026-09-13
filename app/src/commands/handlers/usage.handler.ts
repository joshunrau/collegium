import { Injectable } from '@nestjs/common';

import { TurnsService } from '@/turns/turns.service.ts';

import { CommandHandler } from '../commands.handler.ts';
import { renderUsageResponse, USAGE_WINDOW_HOURS } from './usage.utils.ts';

import type { CommandResponse } from '../commands.types.ts';

const USAGE_WINDOW_MS = USAGE_WINDOW_HOURS * 60 * 60 * 1000;

/** §8.4 — framework-wide token spend; ephemeral because it counts activity in channels the invoker may not belong to */
@Injectable()
export class UsageHandler extends CommandHandler {
  readonly trigger = 'usage';

  constructor(private readonly turnsService: TurnsService) {
    super();
  }

  async handle(): Promise<CommandResponse> {
    const since = new Date(Date.now() - USAGE_WINDOW_MS);
    const summaries = await this.turnsService.summarizeTokenUsageEndedAfter(since);
    return { audience: 'invoker', text: renderUsageResponse(summaries) };
  }
}
