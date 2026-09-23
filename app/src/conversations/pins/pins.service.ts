import { Result } from '@collegium/core/utils';
import { Injectable } from '@nestjs/common';

import type { ChatTransport } from '@/chat/chat.transport.ts';
import type { ChatFailure } from '@/chat/chat.types.ts';
import { InjectModel } from '@/prisma/prisma.decorators.ts';
import type { Model, ModelRow } from '@/prisma/prisma.types.ts';

import { ConversationsService } from '../conversations.service.ts';
import { EpisodesService } from '../episodes/episodes.service.ts';

import type { RecordablePost } from '../conversations.types.ts';

/**
 * §3.8, §8.2 — which posts are pinned in a channel, as Mattermost last reported it. A pinned post's
 * text is the one edit the store follows, so a standing instruction revised in place never reads
 * stale; every other post keeps the text it was recorded with.
 */
@Injectable()
export class PinsService {
  constructor(
    private readonly conversationsService: ConversationsService,
    private readonly episodesService: EpisodesService,
    @InjectModel('Post') private readonly posts: Model<'Post'>
  ) {}

  /**
   * §3.8 — every post pinned in the channel, oldest first. Pins stand whatever episode boundary an
   * agent has; a forgotten post is as absent here as from the window (§8.4).
   */
  listPinned(channelId: string): Promise<ModelRow<'Post'>[]> {
    return this.posts.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      where: { channelId, isForgotten: false, isPinned: true }
    });
  }

  /**
   * A post pinned now, recorded first where the store never saw it, since a person may pin a post
   * older than its history — but never one the channel's last clear erased: that is a post the
   * clear's deletion missed in Mattermost, and recording it would undo the clear (§8.5).
   */
  async pin(post: RecordablePost): Promise<void> {
    if (!(await this.episodesService.isErasedByClear(post))) {
      await this.conversationsService.record(post);
    }
    await this.posts.updateMany({ data: { isPinned: true, message: post.message }, where: { id: post.id } });
  }

  /** §8.2 — the channel's pins as Mattermost holds them now, whatever events a restart or a dropped socket missed */
  async reconcile(transport: ChatTransport, channelId: string): Promise<Result<void, ChatFailure>> {
    const pinned = await transport.pinnedPosts(channelId);
    if (!pinned.success) {
      return Result.err(pinned.error);
    }
    for (const post of pinned.value) {
      await this.pin(post);
    }
    await this.posts.updateMany({
      data: { isPinned: false },
      where: { channelId, id: { notIn: pinned.value.map(({ id }) => id) }, isPinned: true }
    });
    return Result.ok();
  }

  /** read before it writes: every edit of a post not pinned arrives here, a status post's on every agent's socket */
  async unpin(postId: string): Promise<void> {
    const pinned = await this.posts.findFirst({ select: { id: true }, where: { id: postId, isPinned: true } });
    if (pinned === null) {
      return;
    }
    await this.posts.updateMany({ data: { isPinned: false }, where: { id: postId, isPinned: true } });
  }
}
