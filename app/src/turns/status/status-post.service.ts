import { Injectable } from '@nestjs/common';

import { TransportRegistry } from '@/chat/transports/transport.registry.ts';
import { ConversationsService } from '@/conversations/conversations.service.ts';
import { LoggingService } from '@/logging/logging.service.ts';
import type { TurnStatus } from '@/prisma/prisma.types.ts';

import { TurnsService } from '../turns.service.ts';
import { renderStatusPost } from './status-post.renderer.ts';

import type { AbandonedStatusPost } from '../turns.types.ts';
import type { StatusPostState } from './status-post.renderer.ts';

type OpenInput = {
  agentUsername: string;
  channelId: string;
  turnId: string;
};

/**
 * One post per turn, edited in place as the trace accumulates (§8.1). Edits coalesce: a line is
 * queued and lands on the next edit with whatever else queued by then, so a turn never waits on
 * the chat server between one tool call and the next. Only `close` waits, for every queued edit.
 */
export type StatusPostHandle = {
  appendTrace(line: string): void;
  close(outcome: Exclude<TurnStatus, 'running'>): Promise<void>;
  /** text alongside a tool call is transient status, replaced on the next edit (§3.3) */
  setTransient(text: string): void;
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

  /**
   * §7.3 — a turn whose process died closes its own post from the next boot: the trace it
   * accumulated stays and only the working line becomes an outcome. The first line is the working
   * or outcome line by construction, so the rest of the stored text is the trace verbatim.
   */
  async closeAbandoned(post: AbandonedStatusPost): Promise<void> {
    try {
      const stored = await this.conversationsService.findAuthoredMessage(post.postId);
      if (stored === undefined) {
        return;
      }
      const text = renderStatusPost({ outcome: 'abandoned', traceLines: stored.split('\n').slice(1) });
      const updated = await this.transportRegistry.get(post.agentUsername).updatePost(post.postId, { text });
      if (!updated.success) {
        this.loggingService.error(
          new Error(`failed to close abandoned status post ${post.postId}: ${updated.error.message}`)
        );
        return;
      }
      await this.recordEdited(post.postId, text);
    } catch (error) {
      this.loggingService.error(new Error(`failed to close abandoned status post ${post.postId}`, { cause: error }));
    }
  }

  open(input: OpenInput): StatusPostHandle {
    const transport = this.transportRegistry.get(input.agentUsername);
    const state: StatusPostState = { traceLines: [] };
    const openedAt = Date.now();
    let postId: string | undefined;
    let openFailed = false;
    let dirty = false;
    let touched = false;
    let inFlight: Promise<void> | undefined;
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
    const drain = async (): Promise<void> => {
      while (dirty) {
        dirty = false;
        try {
          await sync();
        } catch (error) {
          this.loggingService.error(new Error('failed to sync the status post', { cause: error }));
        }
      }
      inFlight = undefined;
    };
    const schedule = (): Promise<void> => {
      touched = true;
      dirty = true;
      inFlight ??= drain();
      return inFlight;
    };
    return {
      appendTrace: (line) => {
        state.traceLines.push(line);
        void schedule();
      },
      close: (outcome) => {
        if (!touched) {
          return Promise.resolve();
        }
        state.elapsedMs = Date.now() - openedAt;
        state.outcome = outcome;
        state.transientText = undefined;
        return schedule();
      },
      setTransient: (text) => {
        state.transientText = text;
        void schedule();
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
          attachments: [],
          authorKind: 'agent',
          authorUsername: input.agentUsername,
          channelId: input.channelId,
          createdAt: created.createdAt,
          id: created.postId,
          message: created.text
        },
        { kind: 'status', turnId: input.turnId }
      );
      await this.turnsService.recordStatusPost(input.turnId, created.postId);
    } catch (error) {
      this.loggingService.error(new Error(`failed to record status post ${created.postId}`, { cause: error }));
    }
  }
}
