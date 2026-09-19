import { Injectable } from '@nestjs/common';

import { renderRefusal } from '@/clearing/clearing.renderer.ts';
import { ClearingService } from '@/clearing/clearing.service.ts';

import { renderUsage } from '../commands.definitions.ts';
import { CommandHandler } from '../commands.handler.ts';
import { parseClearArguments } from './clear.utils.ts';

import type { CommandInput, CommandResponse } from '../commands.types.ts';

/** §8.5 — the dialog is the whole answer here; the clear itself runs on its submission */
@Injectable()
export class ClearHandler extends CommandHandler {
  readonly trigger = 'clear';

  constructor(private readonly clearingService: ClearingService) {
    super();
  }

  async handle(input: CommandInput): Promise<CommandResponse> {
    const parsed = parseClearArguments(input.text);
    if (parsed === undefined) {
      return { audience: 'invoker', text: renderUsage(this.trigger) };
    }
    const prepared = await this.clearingService.prepare({
      byUsername: input.username,
      channelId: input.channelId,
      memories: parsed.memories,
      triggerId: input.triggerId
    });
    return { audience: 'invoker', text: prepared.success ? '' : renderRefusal(prepared.error) };
  }
}
