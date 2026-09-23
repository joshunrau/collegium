import { Injectable } from '@nestjs/common';

import { AgentRegistry } from '@/agents/agents.registry.ts';
import type { AgentProfile } from '@/agents/agents.types.ts';
import { ChannelsService } from '@/channels/channels.service.ts';
import type { LockHandle } from '@/channels/channels.types.ts';
import { ChannelLockService } from '@/channels/locks/channel-lock.service.ts';
import { MultiMentionPolicy } from '@/channels/refusals/multi-mention.policy.ts';
import { RosterService } from '@/channels/roster/roster.service.ts';
import { TransportRegistry } from '@/chat/transports/transport.registry.ts';
import { ConversationsService } from '@/conversations/conversations.service.ts';
import type { ObservedPost } from '@/conversations/conversations.types.ts';
import { restoreObservedPost } from '@/conversations/conversations.utils.ts';
import { HaltService } from '@/halt/halt.service.ts';
import { LoggingService } from '@/logging/logging.service.ts';
import { NotificationsService } from '@/notifications/notifications.service.ts';
import type { TurnStatus } from '@/prisma/prisma.types.ts';
import { QueueService } from '@/queue/queue.service.ts';
import { TriggersService } from '@/triggers/triggers.service.ts';
import { TurnFoldRegistry } from '@/turns/folding/turn-fold.registry.ts';
import { TurnRunner } from '@/turns/turns.runner.ts';
import { TurnsService } from '@/turns/turns.service.ts';
import type { AbandonedTurn, HeldActivation, TurnOpenFailure, TurnOutcome, UnactedTurn } from '@/turns/turns.types.ts';
import { extractMentionedUsernames } from '@/utils/mention.utils.ts';

import { QUEUED_ACKNOWLEDGEMENT_EMOJI } from './activation.constants.ts';
import {
  activatesOnArrival,
  toActivationChainLength,
  toActivationDepth,
  toActivationRootPostId,
  toFoldAuthorUsername
} from './activation.utils.ts';
import { DebounceService } from './debounce/debounce.service.ts';

/**
 * §7.1 — the queue drains only into a turn that can plausibly make progress. After a provider
 * outage or rejection, semantic error, side-effect ambiguity, or delivery failure it is left
 * standing: a drain would start a turn that inherits the same failure, looping until the hourly
 * ceiling halts everything. Context exhaustion is not inherited: what overflowed was one turn's own
 * results, and the window a fresh turn assembles is bounded by its budget.
 */
const PROGRESS_EXITS: ReadonlySet<TurnStatus> = new Set<TurnStatus>([
  'budget_exhausted',
  'completed',
  'context_exhausted',
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
    private readonly rosterService: RosterService,
    private readonly transportRegistry: TransportRegistry,
    private readonly triggersService: TriggersService,
    private readonly turnFoldRegistry: TurnFoldRegistry,
    private readonly turnRunner: TurnRunner,
    private readonly turnsService: TurnsService
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
      // §4.4 — a fragment rarely repeats the mention, so a post addressing nobody is the only one
      // that continues a sentence rather than starting a request; one addressing a peer is a
      // request being made. Whichever of the two is live takes it; neither creates itself, so an
      // unaddressed post in a quiet channel stays inert.
      if (this.multiMentionPolicy.addresseesOf(post).length === 0) {
        this.offerToLiveTurn(profile, post);
      }
      if (this.debounceService.touch(batch)) {
        this.signalTyping(profile, post.channelId);
      }
      return;
    }
    if (!activatesOnArrival(post)) {
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

  /**
   * §7.3 — a hold lives only in the turn holding it (§5.2), so for each turn a restart abandoned it
   * is recomputed from the store: the colleague the turn's posts addressed goes into the queue at
   * the earliest of them that no turn of that colleague in the channel has started since, for the
   * boot sweep to drain. Who a post addressed is read against the roster (§4.5), so this runs only
   * once the roster has reconciled. Returns how many went into the queue.
   */
  async requeueHeld(turns: readonly AbandonedTurn[]): Promise<number> {
    let requeued = 0;
    for (const turn of turns) {
      const held = await this.findUnreleasedHold(turn);
      if (held === undefined) {
        continue;
      }
      await this.putBackInQueue(held.addresseeUsername, turn.channelId, held.postId);
      requeued += 1;
    }
    return requeued;
  }

  /**
   * §7.3 — puts back in the queue the post each unacted abandoned turn started from, for the boot
   * sweep to drain, and returns how many went back. A system bot post stays out (§5.2), and so does
   * one the store does not hold, whose author is unknown.
   */
  async requeueUnacted(turns: readonly UnactedTurn[]): Promise<number> {
    let requeued = 0;
    for (const turn of turns) {
      const source = await this.conversationsService.findActivationSource(turn.triggeringPostId);
      if (source === undefined || source.authorKind === 'system') {
        continue;
      }
      await this.putBackInQueue(turn.agentUsername, turn.channelId, turn.triggeringPostId);
      requeued += 1;
    }
    return requeued;
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

  /** §5.2 — the 👀 on a post that waits behind a busy agent; a failure to react is logged, and the post stays queued */
  private async acknowledgeQueued(agentUsername: string, postId: string): Promise<void> {
    const acknowledged = await this.transportRegistry
      .get(agentUsername)
      .addReaction(postId, QUEUED_ACKNOWLEDGEMENT_EMOJI);
    if (!acknowledged.success) {
      this.loggingService.error(
        new Error(`failed to acknowledge queued post ${postId}: ${acknowledged.error.message}`)
      );
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

  /**
   * §5.2 — the colleague an agent's turn addressed, started once that turn ends or parks. The held
   * post joins the colleague's queue first, so a halt, the ceiling or a busy colleague leaves it
   * standing rather than lost, and the drain runs §7.4 admission on it as on any other. Nothing
   * awaits this: the turn that released it must not wait on its colleague's.
   */
  private async activateHeld(channelId: string, held: HeldActivation): Promise<void> {
    const profile = this.agentRegistry.get(held.addresseeUsername);
    if (!profile) {
      this.loggingService.warn(`dropping a held activation for unknown agent "${held.addresseeUsername}"`);
      return;
    }
    try {
      await this.putBackInQueue(profile.username, channelId, held.postId);
      if (this.channelLockService.isBusy(profile.username, channelId)) {
        await this.acknowledgeQueued(profile.username, held.postId);
        return;
      }
      await this.drainQueue(profile, channelId);
    } catch (error) {
      this.loggingService.error(
        new Error(`failed to start "${profile.username}" in ${channelId} from a held post`, { cause: error })
      );
    }
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
   * §5.2 — a turn that completed owes no second turn for an entry it read whole: the earliest queued
   * post is in its window, which runs unbroken from there to the newest post, and nothing that could
   * be queued reached the store after the assembly began. A failure is logged, not thrown, and the
   * queue then drains as before.
   */
  private async consumeWhatTheTurnRead(profile: AgentProfile, channelId: string, ended: TurnOutcome): Promise<boolean> {
    try {
      const entry = await this.queueService.peek(profile.username, channelId);
      if (entry === undefined || !ended.windowPostIds.has(entry.earliestUnprocessedPostId)) {
        return false;
      }
      const arrivedSince = await this.conversationsService.hasPostsObservedSince({
        agentUsername: profile.username,
        channelId,
        since: ended.contextAssembledAt
      });
      if (arrivedSince || !(await this.queueService.consumeIfUnchanged(entry))) {
        return false;
      }
      this.loggingService.log(
        `consumed the queue for "${profile.username}" in ${channelId}: the turn that completed had read every post in it`
      );
      return true;
    } catch (error) {
      this.loggingService.error(
        new Error(`failed to consume the queue for "${profile.username}" in ${channelId}`, { cause: error })
      );
      return false;
    }
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
        `left the queue for "${profile.username}" in ${channelId} standing: the turn ceiling refused admission — /collegium resume will drain it`
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
      triggeringPostId: await this.findDrainTriggeringPost(profile, channelId, entry.earliestUnprocessedPostId)
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
    await this.acknowledgeQueued(profile.username, post.id);
  }

  /**
   * §5.2 — the newest post a person addressed to the agent among what a drain covers, else the
   * earliest queued. Only posts since the agent's previous turn here began count: a colleague's post
   * is queued once its author stops acting, so a drain from it can reach back past the person's post
   * that started the previous turn, which that turn answered. A failure falls back rather than
   * throws, since the lock is held and the entry already drained.
   */
  private async findDrainTriggeringPost(
    profile: AgentProfile,
    channelId: string,
    earliestPostId: string
  ): Promise<string> {
    try {
      const posts = await this.conversationsService.listPersonPostsFrom({
        channelId,
        fromPostId: earliestPostId,
        observedSince: await this.turnsService.findLatestStartIn(profile.username, channelId)
      });
      const isDirectMessage = this.rosterService.isDirectMessage(channelId);
      const newest = posts.find((post) => this.isWorkFor(profile, restoreObservedPost(post, isDirectMessage)));
      return newest?.id ?? earliestPostId;
    } catch (error) {
      this.loggingService.error(
        new Error(`failed to find the newest person's post to "${profile.username}" in ${channelId}`, { cause: error })
      );
      return earliestPostId;
    }
  }

  /** §7.3 — the earliest post of the turn addressing its one colleague (§4.5) that no turn of that colleague here started after */
  private async findUnreleasedHold(turn: AbandonedTurn): Promise<HeldActivation | undefined> {
    const authored = await this.conversationsService.listAuthoredBy(turn.turnId);
    const addressing = authored.flatMap((post) => {
      const [addresseeUsername] = this.multiMentionPolicy.addresseesOf({
        authorUsername: turn.agentUsername,
        channelId: turn.channelId,
        mentionedUsernames: extractMentionedUsernames(post.message)
      });
      return addresseeUsername === undefined ? [] : [{ addresseeUsername, post }];
    });
    const first = addressing[0];
    if (first === undefined) {
      return undefined;
    }
    const since = await this.turnsService.findLatestStartIn(first.addresseeUsername, turn.channelId);
    const pending = addressing.find(({ addresseeUsername, post }) => {
      return addresseeUsername === first.addresseeUsername && (since === undefined || post.observedAt > since);
    });
    return pending && { addresseeUsername: pending.addresseeUsername, postId: pending.post.id };
  }

  private isWorkFor(profile: AgentProfile, post: ObservedPost): boolean {
    if (!activatesOnArrival(post) || this.multiMentionPolicy.refuses(post)) {
      return false;
    }
    const mode = this.channelsService.getTriggeringMode({
      channelId: post.channelId,
      isDirectMessage: post.isDirectMessage
    });
    return this.agentRegistry.isAddressedBy(profile, post, mode);
  }

  /**
   * §7.1 — a failed exit leaves the queue standing, and the row was consumed when this turn
   * started, so the post it started from is pointed at again. Still under the lock, because a post
   * arriving during the turn went through enqueueBusy and may hold the row already. A failure here
   * is logged, not thrown: the lock must be released whatever happens.
   *
   * Returns whether the post that claimed the row is a human's. Such a post is the "next human
   * post" a standing queue drains at, already arrived and already 👀-acknowledged (§5.2), so the
   * caller drains at once rather than waiting for a post that may never come. A peer's mention is
   * not: it waits for a human like any other standing entry.
   */
  private async leaveStanding(profile: AgentProfile, channelId: string, postId: string): Promise<boolean> {
    try {
      const claimed = await this.putBackInQueue(profile.username, channelId, postId);
      if (claimed === undefined) {
        return false;
      }
      const source = await this.conversationsService.findActivationSource(claimed);
      return source?.authorKind === 'human';
    } catch (error) {
      this.loggingService.error(
        new Error(`failed to leave the queue for "${profile.username}" in ${channelId} standing`, { cause: error })
      );
      return false;
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

  /**
   * Points the queue at a post again. Another post may already hold the row, and a duplicate insert
   * is ignored by design, so the pointer is then moved back to whichever of the two is earlier.
   * Returns the post that had claimed the row, where one had.
   */
  private async putBackInQueue(agentUsername: string, channelId: string, postId: string): Promise<string | undefined> {
    await this.queueService.enqueue(agentUsername, channelId, postId);
    const standing = await this.queueService.peek(agentUsername, channelId);
    if (!standing || standing.earliestUnprocessedPostId === postId) {
      return undefined;
    }
    const claimed = standing.earliestUnprocessedPostId;
    const earliest = await this.conversationsService.earliestOf([claimed, postId]);
    if (earliest === postId) {
      await this.queueService.pointAt(agentUsername, channelId, postId);
    }
    return claimed;
  }

  /** whether this post is work for the agent, and if so, the queue entry that says so (§5.2) */
  private async queueIfAddressed(profile: AgentProfile, post: ObservedPost): Promise<boolean> {
    if (!this.isWorkFor(profile, post)) {
      return false;
    }
    await this.enqueueBusy(profile, post);
    return true;
  }

  /**
   * §7.4 — an activation the chain limit refuses is refused, not deferred: the mention post starts
   * nothing and is queued nowhere, and the system bot says so under it. A standing row this
   * activation had already drained is put back only where a person wrote it, since the 👀 on it
   * promised a read and a person's post starts a fresh chain; a peer's mention put back would be
   * refused again at every sweep.
   */
  private async refuseChainTurn(
    profile: AgentProfile,
    input: { channelId: string; drainedFromPostId?: string; lock: LockHandle },
    refusal: TurnOpenFailure.ChainFull
  ): Promise<void> {
    let humanWaiting = false;
    try {
      if (input.drainedFromPostId !== undefined) {
        const drained = await this.conversationsService.findActivationSource(input.drainedFromPostId);
        if (drained?.authorKind === 'human') {
          humanWaiting = await this.leaveStanding(profile, input.channelId, input.drainedFromPostId);
        } else {
          this.loggingService.warn(
            `dropped the queue entry for "${profile.username}" in ${input.channelId}: the chain limit refused the peer mention it pointed at`
          );
        }
      }
    } finally {
      input.lock.release();
    }
    await this.notificationsService.notify({
      agentUsername: profile.username,
      channelId: input.channelId,
      kind: 'chain-limit-refusal',
      limit: refusal.limit
    });
    if (humanWaiting) {
      await this.drainQueue(profile, input.channelId);
    }
  }

  private async runTurn(
    profile: AgentProfile,
    input: { channelId: string; drainedFromPostId?: string; lock: LockHandle; triggeringPostId: string }
  ): Promise<void> {
    let ended: TurnOutcome | undefined;
    try {
      const source = await this.conversationsService.findActivationSource(input.triggeringPostId);
      const outcome = await this.turnRunner.run({
        chainLength: toActivationChainLength(source),
        channelId: input.channelId,
        depth: toActivationDepth(source, profile.username),
        drainedFromPostId: input.drainedFromPostId,
        foldAuthorUsername: toFoldAuthorUsername(source),
        profile,
        releaseHeldActivation: (held) => void this.activateHeld(input.channelId, held),
        rootPostId: toActivationRootPostId(source, input.triggeringPostId),
        triggeringPostId: input.triggeringPostId
      });
      if (!outcome.success) {
        await this.refuseChainTurn(profile, input, outcome.error);
        return;
      }
      ended = outcome.value;
    } catch (error) {
      this.loggingService.error(
        new Error(`a turn for "${profile.username}" threw past the runner and is treated as a failed exit`, {
          cause: error
        })
      );
    }
    const progressed = ended !== undefined && PROGRESS_EXITS.has(ended.status);
    let humanWaiting = false;
    let consumed = false;
    try {
      if (!progressed) {
        humanWaiting = await this.leaveStanding(
          profile,
          input.channelId,
          input.drainedFromPostId ?? input.triggeringPostId
        );
      } else if (ended?.status === 'completed') {
        consumed = await this.consumeWhatTheTurnRead(profile, input.channelId, ended);
      }
    } finally {
      input.lock.release();
    }
    if ((progressed && !consumed) || humanWaiting) {
      await this.drainQueue(profile, input.channelId);
    }
    if (progressed) {
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
