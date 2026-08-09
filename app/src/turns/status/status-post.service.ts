import { Injectable } from '@nestjs/common';

import { TransportRegistry } from '@/chat/transports/transport.registry.ts';
import { ConversationsService } from '@/conversations/conversations.service.ts';
import { LoggingService } from '@/logging/logging.service.ts';
import type { TurnStatus } from '@/prisma/prisma.types.ts';

import { TurnsService } from '../turns.service.ts';
import { renderStatusPost } from './status-post.renderer.ts';

import type { StatusPostState } from './status-post.renderer.ts';

type OpenInput = {
  agentUsername: string;
  channelId: string;
  turnId: string;
};

/** one post per turn, edited in place as the trace accumulates (§8.1) */
export type StatusPostHandle = {
  appendTrace(line: string): Promise<void>;
  close(outcome: Exclude<TurnStatus, 'running'>): Promise<void>;
  /** text alongside a tool call is transient status, replaced on the next edit (§3.3) */
  setTransient(text: string): Promise<void>;
};

/**
 * The post is created on the first trace line rather than at turn start: a turn that never calls a
 * tool has no machinery worth a post, and its only output should be its reply (§8.1, A5). Every
 * mutation is best-effort — a turn that cannot open or edit its status post still runs, and a
 * failed bookkeeping write degrades supervision, never the work. The store's copy is kept current
 * with each edit, since SQLite is authoritative for conversation content (§8.2) and the agent's
 * own socket never observes its own posts.
 */
@Injectable()
export class StatusPostService {
  constructor(
    private readonly conversationsService: ConversationsService,
    private readonly loggingService: LoggingService,
    private readonly transportRegistry: TransportRegistry,
    private readonly turnsService: TurnsService
  ) {}

  open(input: OpenInput): StatusPostHandle {
    const transport = this.transportRegistry.get(input.agentUsername);
    const state: StatusPostState = { traceLines: [] };
    let postId: string | undefined;
    let openFailed = false;
    const sync = async (): Promise<void> => {
      if (openFailed) {
        return;
      }
      const text = renderStatusPost(state);
      if (postId === undefined) {
        const created = await transport.send({ channelId: input.channelId, text });
        if (!created.success) {
          openFailed = true;
          this.loggingService.error(new Error(`failed to open a status post: ${created.error.message}`));
          return;
        }
        postId = created.value.postId;
        await this.recordOpened(input, { createdAt: created.value.createdAt, postId, text });
        return;
      }
      const updated = await transport.updatePost(postId, { text });
      if (!updated.success) {
        this.loggingService.error(new Error(`failed to edit status post ${postId}: ${updated.error.message}`));
        return;
      }
      await this.recordEdited(postId, text);
    };
    return {
      appendTrace: (line) => {
        state.traceLines.push(line);
        return sync();
      },
      close: (outcome) => {
        if (postId === undefined) {
          return Promise.resolve();
        }
        state.outcome = outcome;
        state.transientText = undefined;
        return sync();
      },
      setTransient: (text) => {
        state.transientText = text;
        return sync();
      }
    };
  }

  private async recordEdited(postId: string, text: string): Promise<void> {
    try {
      await this.conversationsService.updateAuthoredMessage(postId, text);
    } catch (error) {
      this.loggingService.error(new Error(`failed to update the stored status post ${postId}`, { cause: error }));
    }
  }

  private async recordOpened(
    input: OpenInput,
    created: { createdAt: Date; postId: string; text: string }
  ): Promise<void> {
    try {
      await this.conversationsService.record(
        {
          authorKind: 'agent',
          authorUsername: input.agentUsername,
          channelId: input.channelId,
          createdAt: created.createdAt,
          id: created.postId,
          message: created.text
        },
        input.turnId
      );
      await this.turnsService.recordStatusPost(input.turnId, created.postId);
    } catch (error) {
      this.loggingService.error(new Error(`failed to record status post ${created.postId}`, { cause: error }));
    }
  }
}
