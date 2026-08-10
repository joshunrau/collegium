import { Result } from '@collegium/core/utils';
import { Injectable } from '@nestjs/common';

import { AgentRegistry } from '@/agents/agents.registry.ts';
import { RosterService } from '@/channels/roster/roster.service.ts';
import { ChatGateway } from '@/chat/chat.gateway.ts';
import { TransportRegistry } from '@/chat/transports/transport.registry.ts';
import { ConversationsService } from '@/conversations/conversations.service.ts';
import { LoggingService } from '@/logging/logging.service.ts';
import { InjectModel } from '@/prisma/prisma.decorators.ts';
import type { Model, TriggerSource } from '@/prisma/prisma.types.ts';

import { renderTriggerPost } from './triggers.renderer.ts';

import type { Trigger, TriggerFailure, TriggerInput, TriggerResolutionHook } from './triggers.types.ts';

/**
 * §4.2 — external events do not post directly: deterministic code records a row, and the system
 * bot announces it later, only into an idle channel. The table holds things to be announced, not
 * work to be executed, which is why it does not violate A1.
 */
@Injectable()
export class TriggersService {
  private recordedListener: ((channelId: string) => void) | undefined;
  private readonly resolutionHooks = new Map<TriggerSource, TriggerResolutionHook>();

  constructor(
    private readonly agentRegistry: AgentRegistry,
    private readonly chatGateway: ChatGateway,
    private readonly conversationsService: ConversationsService,
    private readonly loggingService: LoggingService,
    private readonly rosterService: RosterService,
    private readonly transportRegistry: TransportRegistry,
    @InjectModel('Trigger') private readonly triggers: Model<'Trigger'>
  ) {}

  listOutstanding(agentUsername: string): Promise<Trigger[]> {
    return this.triggers.findMany({
      orderBy: { createdAt: 'asc' },
      where: { status: { not: 'resolved' }, targetAgentUsername: agentUsername }
    });
  }

  /** every channel holding an unannounced trigger — what the boot and /resume sweep flushes */
  async listPendingChannelIds(): Promise<string[]> {
    const pending = await this.triggers.findMany({
      select: { targetChannelId: true },
      where: { status: 'pending' }
    });
    return [...new Set(pending.map(({ targetChannelId }) => targetChannelId))];
  }

  /** how activation learns of fresh intake without triggers depending on activation */
  onRecorded(listener: (channelId: string) => void): void {
    this.recordedListener = listener;
  }

  /** how a source's own handling joins resolution without triggers depending on that module (§4.6) */
  onResolving(source: TriggerSource, hook: TriggerResolutionHook): void {
    this.resolutionHooks.set(source, hook);
  }

  /** the oldest unannounced trigger, if any — what an idle channel would announce next (§4.2) */
  peekPending(channelId: string): Promise<null | Trigger> {
    return this.triggers.findFirst({
      orderBy: { createdAt: 'asc' },
      where: { status: 'pending', targetChannelId: channelId }
    });
  }

  /**
   * Claims and announces one trigger — one post per trigger, ever: the pending→posted transition
   * is atomic so concurrent flushes cannot double-post, and a failed send releases the claim. The
   * announcement is recorded here rather than waiting for a socket round-trip, so the turn started
   * on it assembles a window that contains it. No idle check of its own: it trusts its single
   * caller, activation, which holds the channel lock while calling (open question 6).
   *
   * Everything that can fail happens before the claim, so the only step inside it is the send, whose
   * failure releases it. A throw between claim and release would leave the row `posted` with no post
   * id — outstanding forever, since every flush path looks for `pending`.
   */
  async post(triggerId: string): Promise<Result<{ postId: string }, TriggerFailure>> {
    const trigger = await this.triggers.findUnique({ where: { id: triggerId } });
    if (!trigger) {
      return Result.err({ kind: 'not-found', triggerId });
    }
    const maxPostSizeChars = await this.chatGateway.maxPostSizeChars();
    if (!maxPostSizeChars.success) {
      return Result.err({
        channelId: trigger.targetChannelId,
        kind: 'channel-unreachable',
        message: maxPostSizeChars.error.message
      });
    }
    const { files, message } = renderTriggerPost(trigger, maxPostSizeChars.value);
    const claimed = await this.triggers.updateMany({
      data: { postedAt: new Date(), status: 'posted' },
      where: { id: triggerId, status: 'pending' }
    });
    if (claimed.count === 0) {
      return Result.err({ kind: 'not-pending', triggerId });
    }
    const posted = await this.chatGateway.postAsSystemIn(trigger.targetChannelId, message, files);
    if (!posted.success) {
      this.loggingService.error(new Error(`failed to post trigger ${trigger.id}: ${posted.error.message}`));
      await this.releaseClaim(triggerId);
      return Result.err({
        channelId: trigger.targetChannelId,
        kind: 'channel-unreachable',
        message: posted.error.message
      });
    }
    await this.triggers.update({ data: { postId: posted.value.postId }, where: { id: triggerId } });
    await this.conversationsService.record({
      authorKind: 'system',
      authorUsername: posted.value.authorUsername,
      channelId: trigger.targetChannelId,
      createdAt: posted.value.createdAt,
      id: posted.value.postId,
      message
    });
    return Result.ok({ postId: posted.value.postId });
  }

  async record(input: TriggerInput): Promise<Result<Trigger, TriggerFailure>> {
    if (input.dedupeKey !== undefined) {
      // a re-observed event — a crash between recording and cursor advance — is the same
      // trigger, not a second announcement: one post per trigger, ever (§4.2)
      const existing = await this.triggers.findUnique({ where: { dedupeKey: input.dedupeKey } });
      if (existing) {
        return Result.ok(existing);
      }
    }
    if (!this.agentRegistry.has(input.targetAgentUsername)) {
      return Result.err({ agentUsername: input.targetAgentUsername, kind: 'unknown-agent' });
    }
    const isDirect = await this.transportRegistry
      .get(input.targetAgentUsername)
      .isDirectMessageChannel(input.targetChannelId);
    if (!isDirect.success) {
      return Result.err({
        channelId: input.targetChannelId,
        kind: 'channel-unreachable',
        message: isDirect.error.message
      });
    }
    if (isDirect.value) {
      return Result.err({ channelId: input.targetChannelId, kind: 'dm-target' });
    }
    if (!this.rosterService.isAgentIn(input.targetAgentUsername, input.targetChannelId)) {
      return Result.err({
        agentUsername: input.targetAgentUsername,
        channelId: input.targetChannelId,
        kind: 'agent-absent'
      });
    }
    const trigger = await this.triggers.create({
      data: {
        dedupeKey: input.dedupeKey,
        reference: input.reference,
        source: input.source,
        status: 'pending',
        targetAgentUsername: input.targetAgentUsername,
        targetChannelId: input.targetChannelId
      }
    });
    this.recordedListener?.(input.targetChannelId);
    return Result.ok(trigger);
  }

  /**
   * Marked handled by the agent through resolve_trigger, and idempotent — a re-mark is a no-op
   * (§4.2). A source that must finish something in the world first does it here (§4.6 marks mail
   * read), and a failure there leaves the row outstanding rather than claiming the work is done.
   */
  async resolve(triggerId: string, agentUsername: string): Promise<Result<void, TriggerFailure>> {
    const trigger = await this.triggers.findFirst({ where: { id: triggerId, targetAgentUsername: agentUsername } });
    if (!trigger) {
      return Result.err({ kind: 'not-found', triggerId });
    }
    if (trigger.status === 'resolved') {
      return Result.ok();
    }
    const hook = this.resolutionHooks.get(trigger.source);
    if (hook) {
      const handled = await hook(trigger);
      if (!handled.success) {
        return Result.err({ kind: 'not-resolvable', message: handled.error.message, triggerId });
      }
    }
    await this.triggers.update({ data: { resolvedAt: new Date(), status: 'resolved' }, where: { id: trigger.id } });
    return Result.ok();
  }

  /** whether this system post announced a trigger — its turn was already started by the flush that posted it */
  async wasAnnouncedBy(postId: string): Promise<boolean> {
    return (await this.triggers.count({ where: { postId } })) > 0;
  }

  /** an unposted trigger goes back to pending, so the next idle flush announces it */
  private async releaseClaim(triggerId: string): Promise<void> {
    await this.triggers.updateMany({
      data: { postedAt: null, status: 'pending' },
      where: { id: triggerId, status: 'posted' }
    });
  }
}
