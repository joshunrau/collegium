import { Injectable } from '@nestjs/common';

import { EpisodesService } from '@/conversations/episodes/episodes.service.ts';
import { QueueService } from '@/queue/queue.service.ts';

import { CommandHandler } from '../commands.handler.ts';
import { requirePostId } from './argument.utils.ts';

import type { CommandInput, CommandResponse } from '../commands.types.ts';

/** §8.4 — repair in the channel, visible and attributable, never a SQL console */
@Injectable()
export class ForgetHandler extends CommandHandler {
  readonly trigger = 'forget';

  constructor(
    private readonly episodesService: EpisodesService,
    private readonly queueService: QueueService
  ) {
    super();
  }

  async handle(input: CommandInput): Promise<CommandResponse> {
    const named = requirePostId(input.text, this.trigger);
    if (!named.success) {
      return named.error;
    }
    const postId = named.value;
    const forgotten = await this.episodesService.forget(postId);
    if (!forgotten.success) {
      return { audience: 'invoker', text: `No post ${postId}.` };
    }
    // §8.4 — a post forgotten because it should not be acted on starts no drain either
    await this.queueService.deletePosts([postId]);
    return { audience: 'channel', text: `🙈 Post ${postId} is removed from agent context.` };
  }
}
