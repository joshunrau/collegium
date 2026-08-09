import { Injectable } from '@nestjs/common';

import { ConversationsService } from '@/conversations/conversations.service.ts';
import { TurnsService } from '@/turns/turns.service.ts';

import { CommandHandler } from '../commands.handler.ts';
import { requirePostId } from './argument.utils.ts';
import { renderTrace } from './trace.utils.ts';

import type { CommandInput, CommandResponse } from '../commands.types.ts';

/** §8.3 — ephemeral on purpose: traces carry file contents and message bodies verbatim */
@Injectable()
export class TraceHandler extends CommandHandler {
  readonly trigger = 'trace';

  constructor(
    private readonly conversationsService: ConversationsService,
    private readonly turnsService: TurnsService
  ) {
    super();
  }

  async handle(input: CommandInput): Promise<CommandResponse> {
    const named = requirePostId(input.text, this.trigger);
    if (!named.success) {
      return named.error;
    }
    const postId = named.value;
    const turn = await this.conversationsService.findAuthoringTurn(postId);
    // raw traces are need-to-know even among humans (§8.2): only the turn's own channel may read one
    if (turn?.channelId !== input.channelId) {
      return { audience: 'invoker', text: `No turn authored post ${postId} in this channel.` };
    }
    return {
      audience: 'invoker',
      text: renderTrace(turn.turnId, await this.turnsService.listEvents(turn.turnId))
    };
  }
}
