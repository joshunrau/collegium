import { Injectable } from '@nestjs/common';

import { AgentRegistry } from '@/agents/agents.registry.ts';
import type { AgentProfile } from '@/agents/agents.types.ts';
import { ChannelsService } from '@/channels/channels.service.ts';
import type { LockHandle } from '@/channels/channels.types.ts';
import { ChannelLockService } from '@/channels/locks/channel-lock.service.ts';
import { MultiMentionPolicy } from '@/channels/refusals/multi-mention.policy.ts';
import { TransportRegistry } from '@/chat/transports/transport.registry.ts';
import { ConversationsService } from '@/conversations/conversations.service.ts';
import type { ObservedPost } from '@/conversations/conversations.types.ts';
import { HaltService } from '@/halt/halt.service.ts';
import { LoggingService } from '@/logging/logging.service.ts';
import { NotificationsService } from '@/notifications/notifications.service.ts';
import type { TurnStatus } from '@/prisma/prisma.types.ts';
import { QueueService } from '@/queue/queue.service.ts';
import { TriggersService } from '@/triggers/triggers.service.ts';
import { TurnFoldRegistry } from '@/turns/folding/turn-fold.registry.ts';
import { TurnRunner } from '@/turns/turns.runner.ts';

import { QUEUED_ACKNOWLEDGEMENT_EMOJI } from './activation.constants.ts';
import { toActivationDepth, toFoldAuthorUsername } from './activation.utils.ts';
import { DebounceService } from './debounce/debounce.service.ts';

/**
 * §7.1 — the queue drains only into a turn that can plausibly make progress. After a provider
 * outage, semantic error, or side-effect ambiguity it is left standing: a drain would start a turn
 * that inherits the same failure, looping until the hourly ceiling halts everything.
 */
const PROGRESS_EXITS: ReadonlySet<TurnStatus> = new Set<TurnStatus>([
  'budget_exhausted',
  'completed',
  'denied',
  'killed',
  'stopped'
]);

/**
 * The single ingestion path: record → classify → address → debounce → lock → run. This is the only
 * module that both starts turns and reacts to their ending, which is what keeps the graph acyclic —
 * when a turn ends, activation releases the lock and drains the queue.
 */
@Injectable()
export class ActivationService {
  constructor(
    private readonly agentRegistry: AgentRegistry,
    private readonly channelLockService: ChannelLockService,
    private readonly channelsService: ChannelsService,
    private readonly conversationsService: ConversationsService,
    private readonly debounceService: DebounceService,
    private readonly haltService: HaltService,
    private readonly loggingService: LoggingService,
    private readonly multiMentionPolicy: MultiMentionPolicy,
    private readonly notificationsService: NotificationsService,
    private readonly queueService: QueueService,
    private readonly transportRegistry: TransportRegistry,
    private readonly triggersService: TriggersService,
    private readonly turnFoldRegistry: TurnFoldRegistry,
    private readonly turnRunner: TurnRunner
  ) {}

  /**
   * The full §4.2 idle predicate lives here, because only this module sees the lock, pending
   * approvals (which hold the lock), and its own debounce timers (open question 6). The channel
   * lock is taken before the announcement posts and the turn starts under it, so the idle check is
   * atomic with the turn start — a trigger can never land in a channel that just went busy and be
   * dropped, which would strand it forever.
   */
  async flushTriggersIfIdle(channelId: string): Promise<void> {
    if (this.haltService.isHalted()) {
      return;
    }
    if (!this.channelLockService.isChannelIdle(channelId)) {
      return;
    }
    if (this.debounceService.isDebouncing(channelId)) {
      return;
    }
    const next = await this.triggersService.peekPending(channelId);
    if (!next) {
      return;
    }
    const profile = this.agentRegistry.get(next.targetAgentUsername);
    if (!profile) {
      this.loggingService.warn(`holding a trigger for unknown agent "${next.targetAgentUsername}"`);
      return;
    }
    const lock = this.channelLockService.acquire(profile.username, channelId);
    if (!lock) {
      return;
    }
    if (!(await this.haltService.admitTurnStart())) {
      lock.release();
      return;
    }
    const posted = await this.triggersService.post(next.id);
    if (!posted.success) {
      lock.release();
      return;
    }
    await this.runTurn(profile, { channelId, lock, triggeringPostId: posted.value.postId });
  }

  /** the agent stays on the signature — never re-derived from the roster cache (§4.5) */
  async onPost(profile: AgentProfile, post: ObservedPost): Promise<void> {
    const inserted = await this.conversationsService.record(post);
    if (post.authorKind === 'system' && (await this.triggersService.wasAnnouncedBy(post.id))) {
      return;
    }
    if (this.multiMentionPolicy.refuses(post)) {
      if (inserted) {
        await this.notificationsService.notify({ channelId: post.channelId, kind: 'multi-mention-refusal' });
      }
      return;
    }
    const mode = this.channelsService.getTriggeringMode({
      channelId: post.channelId,
      isDirectMessage: post.isDirectMessage
    });
    const batch = {
      agentUsername: profile.username,
      authorUsername: post.authorUsername,
      channelId: post.channelId
    };
    if (!this.agentRegistry.isAddressedBy(profile, post, mode)) {
      // §4.4 — a fragment rarely repeats the mention, so this is the only post that continues a
      // sentence rather than starting a request. Whichever of the two is live takes it; neither
      // creates itself, so an unaddressed post in a quiet channel stays inert.
      this.offerToLiveTurn(profile, post);
      if (this.debounceService.touch(batch)) {
        this.signalTyping(profile, post.channelId);
      }
      return;
    }
    if (this.channelLockService.isBusy(profile.username, post.channelId)) {
      await this.enqueueBusy(profile, post);
      return;
    }
    this.signalTyping(profile, post.channelId);
    this.debounceService.schedule(batch, () => this.activate(profile, post));
  }

  /**
   * §5.2 — posts a reconnect recovered. They are queued rather than activated: a gap holds an
   * unknown number of posts, and ten missed mentions must become one turn rather than ten, which is
   * what the queue is for. Draining happens once per affected channel, after everything is in, so
   * the turn that answers assembles a window containing all of it. Unaddressed posts are recorded
   * and reach the next turn as ordinary history.
   */
  async onResynced(profile: AgentProfile, posts: readonly ObservedPost[]): Promise<void> {
    const queuedChannelIds = new Set<string>();
    for (const post of posts) {
      if (await this.queueIfAddressed(profile, post)) {
        queuedChannelIds.add(post.channelId);
      }
    }
    for (const channelId of queuedChannelIds) {
      await this.drainQueue(profile, channelId);
    }
  }

  /** the boot and /resume sweep: standing queues drain and held triggers flush (§7.3, §7.4) */
  async sweep(): Promise<void> {
    const entries = await this.queueService.listAll();
    for (const entry of entries) {
      const profile = this.agentRegistry.get(entry.agentUsername);
      if (!profile) {
        this.loggingService.warn(`dropping a queue entry for unknown agent "${entry.agentUsername}"`);
        continue;
      }
      void this.drainQueue(profile, entry.channelId);
    }
    for (const channelId of await this.triggersService.listPendingChannelIds()) {
      await this.flushTriggersIfIdle(channelId);
    }
  }

  /** during a halt the post is queued rather than lost — it simply starts no turn (§7.4) */
  private activate(profile: AgentProfile, post: ObservedPost): void {
    if (this.haltService.isHalted()) {
      void this.enqueueBusy(profile, post);
      return;
    }
    const lock = this.channelLockService.acquire(profile.username, post.channelId);
    if (!lock) {
      void this.enqueueBusy(profile, post);
      return;
    }
    void this.admitAndRun(profile, post, lock);
  }

  /** the ceiling-refused post takes the queue path, where enqueueBusy already enforces §5.2 */
  private async admitAndRun(profile: AgentProfile, post: ObservedPost, lock: LockHandle): Promise<void> {
    if (!(await this.haltService.admitTurnStart())) {
      lock.release();
      await this.enqueueBusy(profile, post);
      return;
    }
    // §5.2 — this turn's window already covers whatever a non-progress exit left standing, so it
    // absorbs the row. Leaving it would drain the same window into a second turn once this one ends.
    const standing = await this.queueService.drain(profile.username, post.channelId);
    await this.runTurn(profile, {
      channelId: post.channelId,
      drainedFromPostId: standing?.earliestUnprocessedPostId,
      lock,
      triggeringPostId: post.id
    });
  }

  /**
   * Halt-gated: a drain during a halt would start a turn no human has sanctioned (§7.4). Admission
   * is checked before the row is drained, so a refusal leaves the pointer untouched rather than
   * deleting and re-inserting it around a window where a later fragment could replace it.
   */
  private async drainQueue(profile: AgentProfile, channelId: string): Promise<void> {
    if (this.haltService.isHalted()) {
      return;
    }
    const pending = await this.queueService.peek(profile.username, channelId);
    if (!pending) {
      return;
    }
    const lock = this.channelLockService.acquire(profile.username, channelId);
    if (!lock) {
      // A4: never give up silently — the entry stands until whoever holds the lock finishes and drains
      this.loggingService.warn(
        `left the queue for "${profile.username}" in ${channelId} standing: another turn holds the lock`
      );
      return;
    }
    if (!(await this.haltService.admitTurnStart())) {
      this.loggingService.warn(
        `left the queue for "${profile.username}" in ${channelId} standing: the turn ceiling refused admission — /collegium.resume will drain it`
      );
      lock.release();
      return;
    }
    const entry = await this.queueService.drain(profile.username, channelId);
    if (!entry) {
      this.loggingService.warn(
        `found the queue for "${profile.username}" in ${channelId} already drained by a concurrent activation`
      );
      lock.release();
      return;
    }
    await this.runTurn(profile, {
      channelId,
      drainedFromPostId: entry.earliestUnprocessedPostId,
      lock,
      triggeringPostId: entry.earliestUnprocessedPostId
    });
  }

  /** §4.4 — fragments arriving while the agent is busy skip debounce and land in the queue */
  private async enqueueBusy(profile: AgentProfile, post: ObservedPost): Promise<void> {
    if (post.authorKind === 'system') {
      this.loggingService.warn(
        `dropped a system bot post addressed to a busy "${profile.username}" — nothing from the system bot is queued (§5.2)`
      );
      return;
    }
    await this.queueService.enqueue(profile.username, post.channelId, post.id);
    const acknowledged = await this.transportRegistry
      .get(profile.username)
      .addReaction(post.id, QUEUED_ACKNOWLEDGEMENT_EMOJI);
    if (!acknowledged.success) {
      this.loggingService.error(
        new Error(`failed to acknowledge queued post ${post.id}: ${acknowledged.error.message}`)
      );
    }
  }

  /**
   * §4.4 — a fragment that missed the window folds into the turn already answering that human,
   * which has not yet acted on its first completion. The reply is the acknowledgement, so an
   * absorbed fragment gets neither a queue entry nor a 👀 (§5.2).
   *
   * Only ever reached for an unaddressed post. A human who repeats the mention is making a new
   * request, not finishing a sentence, and the model call this turn is inside may run for as long
   * as the inference timeout — long enough that swallowing addressed posts would silently drop
   * work the §5.2 acknowledgement promised to keep.
   */
  private offerToLiveTurn(profile: AgentProfile, post: ObservedPost): boolean {
    return this.turnFoldRegistry.offer({
      agentUsername: profile.username,
      authorUsername: post.authorUsername,
      channelId: post.channelId,
      postId: post.id
    });
  }

  /** whether this post is work for the agent, and if so, the queue entry that says so (§5.2) */
  private async queueIfAddressed(profile: AgentProfile, post: ObservedPost): Promise<boolean> {
    if (this.multiMentionPolicy.refuses(post)) {
      return false;
    }
    const mode = this.channelsService.getTriggeringMode({
      channelId: post.channelId,
      isDirectMessage: post.isDirectMessage
    });
    if (!this.agentRegistry.isAddressedBy(profile, post, mode)) {
      return false;
    }
    await this.enqueueBusy(profile, post);
    return true;
  }

  private async runTurn(
    profile: AgentProfile,
    input: { channelId: string; drainedFromPostId?: string; lock: LockHandle; triggeringPostId: string }
  ): Promise<void> {
    let status: TurnStatus | undefined;
    try {
      const source = await this.conversationsService.findActivationSource(input.triggeringPostId);
      const outcome = await this.turnRunner.run({
        channelId: input.channelId,
        depth: toActivationDepth(source),
        drainedFromPostId: input.drainedFromPostId,
        foldAuthorUsername: toFoldAuthorUsername(source),
        profile,
        triggeringPostId: input.triggeringPostId
      });
      status = outcome.status;
    } catch (error) {
      this.loggingService.error(
        new Error(
          `a turn for "${profile.username}" threw past the runner — its queue and triggers stand until /collegium.resume or the next post`,
          { cause: error }
        )
      );
    } finally {
      input.lock.release();
    }
    if (status !== undefined && PROGRESS_EXITS.has(status)) {
      await this.drainQueue(profile, input.channelId);
      await this.flushTriggersIfIdle(input.channelId);
    }
  }

  /**
   * §8.1 — the debounce window is otherwise dark: a turn's own indicator lights only once the model
   * call starts, so until then nothing says the message was seen. One frame covers the window
   * because Mattermost expires the signal ~5s after the last one, which `windowMs` stays well under.
   */
  private signalTyping(profile: AgentProfile, channelId: string): void {
    this.transportRegistry.get(profile.username).signalTyping(channelId);
  }
}
