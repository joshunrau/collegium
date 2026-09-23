import { removeTrailingSlash, Result } from '@collegium/core/utils';
import { Injectable } from '@nestjs/common';

import { AgentRegistry } from '@/agents/agents.registry.ts';
import type { LockHandle } from '@/channels/channels.types.ts';
import { ChannelLockService } from '@/channels/locks/channel-lock.service.ts';
import { RosterService } from '@/channels/roster/roster.service.ts';
import { CallbackSigner } from '@/chat/callback-auth/callback-signer.service.ts';
import { ChatGateway } from '@/chat/chat.gateway.ts';
import type { ChatFailure, DialogRequest } from '@/chat/chat.types.ts';
import { TransportRegistry } from '@/chat/transports/transport.registry.ts';
import { EnvService } from '@/config/env/env.service.ts';
import { ConversationsService } from '@/conversations/conversations.service.ts';
import type { EpisodeBoundary, RecordablePost } from '@/conversations/conversations.types.ts';
import { WindowService } from '@/conversations/window/window.service.ts';
import { LoggingService } from '@/logging/logging.service.ts';
import { MemoryService } from '@/memory/memory.service.ts';
import type { Announcement } from '@/notifications/announcing/announcing.types.ts';
import { ChannelAnnouncer } from '@/notifications/announcing/channel-announcer.service.ts';

import { CLEARING_PATH, CONFIRMATION_TTL_MS } from './clearing.constants.ts';
import {
  renderClearedNotice,
  renderClearingNotice,
  renderDialogIntroduction,
  renderFailedNotice,
  renderUnremovedNotice
} from './clearing.renderer.ts';
import { toSignedParts } from './confirmation/confirmation.utils.ts';
import { ChannelErasure } from './erasure/channel-erasure.service.ts';

import type { ClearingRefusal, ClearingState, MemoryFailure, MemoryTally } from './clearing.types.ts';

type ClearingRequest = Omit<ClearingState, 'issuedAt'>;

type VisibleErasure = {
  readonly announced: Announcement;
  readonly byUsername: string;
  readonly channelId: string;
  readonly memoryFailures: readonly MemoryFailure[];
};

/** §8.5 — the clear itself: the confirmation before it, the locks and the boundary around it, the notice that reports it */
@Injectable()
export class ClearingService {
  private readonly confirmUrl: string;

  constructor(
    private readonly agentRegistry: AgentRegistry,
    private readonly callbackSigner: CallbackSigner,
    private readonly channelAnnouncer: ChannelAnnouncer,
    private readonly channelErasure: ChannelErasure,
    private readonly channelLockService: ChannelLockService,
    private readonly chatGateway: ChatGateway,
    private readonly conversationsService: ConversationsService,
    envService: EnvService,
    private readonly loggingService: LoggingService,
    private readonly memoryService: MemoryService,
    private readonly rosterService: RosterService,
    private readonly transportRegistry: TransportRegistry,
    private readonly windowService: WindowService
  ) {
    this.confirmUrl = `${removeTrailingSlash(envService.get('APP_PUBLIC_URL'))}${CLEARING_PATH}`;
  }

  /**
   * The submission, after the controller verified its signature. Every agent's lock is taken for
   * the store phase, so no turn can start until the store is cut; the visible phase runs on after
   * the answer, since a large channel's deletion can outlast Mattermost's wait for it.
   */
  async confirm(state: ClearingState): Promise<Result<void, ClearingRefusal>> {
    if (Date.now() - Date.parse(state.issuedAt) > CONFIRMATION_TTL_MS) {
      return Result.err({ kind: 'expired' });
    }
    const locks = this.acquireLocks(state.channelId);
    if (!locks.success) {
      return Result.err({ agentUsernames: locks.error, kind: 'busy' });
    }
    try {
      const sentAt = new Date();
      const text = renderClearingNotice(state.byUsername);
      const announced = await this.channelAnnouncer.announce(state.channelId, text);
      if (announced === undefined) {
        return Result.err({ kind: 'unannounced' });
      }
      const boundary: EpisodeBoundary = { eventsAfter: sentAt, postsAfter: announced.createdAt };
      const notice: RecordablePost = {
        attachments: [],
        authorKind: announced.authorKind,
        authorUsername: announced.authorUsername,
        channelId: state.channelId,
        createdAt: announced.createdAt,
        id: announced.postId,
        message: text
      };
      let tally: readonly MemoryTally[];
      try {
        tally = await this.channelErasure.erase({
          boundary,
          channelId: state.channelId,
          notice,
          selectMemories: state.memories
        });
      } catch (error) {
        this.loggingService.error(error instanceof Error ? error : new Error(String(error)));
        await this.revise(announced, renderFailedNotice());
        return Result.err({ kind: 'store-failed' });
      }
      this.windowService.forgetAnchorsIn(state.channelId);
      const memoryFailures = await this.deleteMemories(tally);
      void this.eraseVisible({ announced, byUsername: state.byUsername, channelId: state.channelId, memoryFailures });
      return Result.ok();
    } finally {
      locks.value.forEach((handle) => handle.release());
    }
  }

  /** the command's half: refuse while a turn runs, else put the dialog in front of the human */
  async prepare(input: ClearingRequest & { triggerId: string | undefined }): Promise<Result<void, ClearingRefusal>> {
    if (input.triggerId === undefined) {
      return Result.err({ kind: 'no-trigger' });
    }
    const busy = this.channelLockService
      .listHeld()
      .filter((held) => held.channelId === input.channelId)
      .map((held) => held.agentUsername);
    if (busy.length > 0) {
      return Result.err({ agentUsernames: busy, kind: 'busy' });
    }
    const state: ClearingState = {
      byUsername: input.byUsername,
      channelId: input.channelId,
      issuedAt: new Date().toISOString(),
      memories: input.memories
    };
    const opened = await this.openDialog(input.channelId, {
      callbackId: input.channelId,
      elements: [],
      introductionText: renderDialogIntroduction(input.memories),
      state: JSON.stringify({ ...state, signature: this.callbackSigner.sign(toSignedParts(state)) }),
      submitLabel: 'Clear',
      title: 'Clear this channel',
      triggerId: input.triggerId,
      url: this.confirmUrl
    });
    if (!opened.success) {
      return Result.err({ kind: 'dialog-undeliverable', message: opened.error.message });
    }
    return Result.ok();
  }

  /** every agent's lock or none: a turn that started while the dialog stood is what the refusal names */
  private acquireLocks(channelId: string): Result<LockHandle[], string[]> {
    const handles: LockHandle[] = [];
    const busy: string[] = [];
    for (const agent of this.rosterService.listAgentsIn(channelId)) {
      const handle = this.channelLockService.acquire(agent.username, channelId);
      if (handle === undefined) {
        busy.push(agent.username);
      } else {
        handles.push(handle);
      }
    }
    if (busy.length > 0) {
      handles.forEach((handle) => handle.release());
      return Result.err(busy);
    }
    return Result.ok(handles);
  }

  /** per agent under its memory lock; a failure is named in the notice rather than swallowed (A4) */
  private async deleteMemories(tally: readonly MemoryTally[]): Promise<MemoryFailure[]> {
    const failures: MemoryFailure[] = [];
    for (const { agentUsername, memoryIds } of tally) {
      try {
        await this.memoryService.deleteMany(agentUsername, memoryIds);
      } catch (error) {
        this.loggingService.error(error instanceof Error ? error : new Error(String(error)));
        failures.push({ displayName: this.agentRegistry.displayNameOf(agentUsername), username: agentUsername });
      }
    }
    return failures;
  }

  /** the detached half: the plugin's deletion, then the notice revised to what actually happened */
  private async eraseVisible(input: VisibleErasure): Promise<void> {
    try {
      const erased = await this.chatGateway.erasePostsBefore(input.channelId, input.announced.postId);
      const text = erased.success
        ? renderClearedNotice({ ...input, report: erased.value })
        : renderUnremovedNotice({ ...input, reason: erased.error.message });
      await this.revise(input.announced, text);
    } catch (error) {
      this.loggingService.error(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /** §7.5 — as the system bot, or through the DM's one agent when the system bot cannot reach the channel */
  private async openDialog(channelId: string, request: DialogRequest): Promise<Result<void, ChatFailure>> {
    const opened = await this.chatGateway.openDialogAsSystem(request);
    if (opened.success) {
      return opened;
    }
    const [agent, ...alsoPresent] = this.rosterService.listAgentsIn(channelId);
    if (!agent || alsoPresent.length > 0) {
      return opened;
    }
    return this.transportRegistry.get(agent.username).openDialog(request);
  }

  /** the notice in the channel and its stored copy, kept the same (§8.1) */
  private async revise(announced: Announcement, text: string): Promise<void> {
    const edited = await announced.edit(text);
    if (!edited.success) {
      this.loggingService.error(
        new Error(`failed to revise the clear notice ${announced.postId}: ${edited.error.message}`)
      );
      return;
    }
    await this.conversationsService.updateAuthoredMessage(announced.postId, text);
  }
}
