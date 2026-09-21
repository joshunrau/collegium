import { Injectable } from '@nestjs/common';

import type { ChatTransport } from '@/chat/chat.transport.ts';
import { TransportRegistry } from '@/chat/transports/transport.registry.ts';
import { ConversationsService } from '@/conversations/conversations.service.ts';
import { LoggingService } from '@/logging/logging.service.ts';
import type { TurnStatus } from '@/prisma/prisma.types.ts';
import type { TraceMark } from '@/tools/tools.types.ts';

import { TurnsService } from '../turns.service.ts';
import { renderAbandonedStatusPost, renderStatusPost } from './status-post.renderer.ts';

import type { AbandonedStatusPost } from '../turns.types.ts';
import type { StatusPostState, TraceEntry } from './status-post.renderer.ts';

type OpenInput = {
  agentUsername: string;
  channelId: string;
  turnId: string;
};

/**
 * §8.1 — the substrate's limit when it cannot be read. The conservative choice: the current
 * Mattermost default is 16383, this the pre-5.x one, and a fallback too small elides trace lines
 * while one too large freezes the post at its working line.
 */
const STATUS_POST_FALLBACK_LIMIT_CHARS = 4000;

/** §8.1 — edits coalesce to this interval; a 200-call turn otherwise makes some 300 of them */
const MIN_EDIT_INTERVAL_MS = 1000;

/** the line a call was traced on, so its disposition can be marked once the call has run (§8.1) */
export type TraceLineHandle = number;

/**
 * One post per turn, edited in place as the trace accumulates (§8.1). Edits coalesce: a line is
 * queued and lands on the next edit with whatever else queued by then, so a turn never waits on
 * the chat server between one tool call and the next. Only `close` waits, for every queued edit.
 */
export type StatusPostHandle = {
  appendTrace(entry: TraceEntry): TraceLineHandle;
  close(outcome: Exclude<TurnStatus, 'running'>): Promise<void>;
  /** §8.1 — a call's disposition, set once its result is known: the line was written before the call ran */
  markTrace(handle: TraceLineHandle, mark: TraceMark): void;
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
      const text = renderAbandonedStatusPost(stored);
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
    let closing = false;
    let inFlight: Promise<void> | undefined;
    let lastSyncAt: number | undefined;
    let limitChars: number | undefined;
    let wake: (() => void) | undefined;
    const waitOutInterval = (ms: number): Promise<void> => {
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          wake = undefined;
          resolve();
        }, ms);
        wake = () => {
          clearTimeout(timer);
          wake = undefined;
          resolve();
        };
      });
    };
    const sync = async (): Promise<void> => {
      if (openFailed) {
        return;
      }
      limitChars ??= await this.readPostLimit(transport);
      const text = renderStatusPost(state, limitChars);
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
    // the create and the closing edit go at once; between them an edit waits out the interval
    const drain = async (): Promise<void> => {
      while (dirty) {
        const wait = lastSyncAt === undefined || closing ? 0 : lastSyncAt + MIN_EDIT_INTERVAL_MS - Date.now();
        if (wait > 0) {
          await waitOutInterval(wait);
        }
        dirty = false;
        lastSyncAt = Date.now();
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
      appendTrace: (entry) => {
        state.traceLines.push(entry);
        void schedule();
        return state.traceLines.length - 1;
      },
      close: (outcome) => {
        if (!touched) {
          return Promise.resolve();
        }
        closing = true;
        wake?.();
        state.elapsedMs = Date.now() - openedAt;
        state.outcome = outcome;
        state.transientText = undefined;
        return schedule();
      },
      markTrace: (handle, mark) => {
        const line = state.traceLines[handle];
        if (line !== undefined) {
          line.mark = mark;
          void schedule();
        }
      },
      setTransient: (text) => {
        state.transientText = text;
        void schedule();
      }
    };
  }

  /** unreadable is not a reason to render an unbounded post; the fallback keeps the closing edit deliverable */
  private async readPostLimit(transport: ChatTransport): Promise<number> {
    const limit = await transport.maxPostSizeChars();
    if (limit.success) {
      return limit.value;
    }
    this.loggingService.warn(
      `could not read MaxPostSize to bound a status post: ${limit.error.message}; using ${STATUS_POST_FALLBACK_LIMIT_CHARS}`
    );
    return STATUS_POST_FALLBACK_LIMIT_CHARS;
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
