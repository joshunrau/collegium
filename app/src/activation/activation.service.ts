import { Injectable } from '@nestjs/common';
import { uniqBy } from 'es-toolkit';

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
import type { ActivationKind, TurnStatus } from '@/prisma/prisma.types.ts';
import { QueueService } from '@/queue/queue.service.ts';
import { chooseDrainTrigger, findEarliestQueued } from '@/queue/queue.utils.ts';
import type { QueueLane } from '@/queue/queue.utils.ts';
import { TriggersService } from '@/triggers/triggers.service.ts';
import { TurnFoldRegistry } from '@/turns/folding/turn-fold.registry.ts';
import { TurnRunner } from '@/turns/turns.runner.ts';
import { TurnsService } from '@/turns/turns.service.ts';
import type {
  AbandonedTurn,
  DeferredHandoff,
  TurnOpenFailure,
  TurnOutcome,
  TurnWithEffects,
  TurnWithoutEffects
} from '@/turns/turns.types.ts';

import { QUEUE_REASONS, QUEUED_ACKNOWLEDGEMENT_EMOJI } from './activation.constants.ts';
import {
  activatesOnArrival,
  toActivationChainLength,
  toActivationDepth,
  toActivationRootPostId,
  toFoldAuthorUsername
} from './activation.utils.ts';
import { DebounceService } from './debounce/debounce.service.ts';

import type { RestartRequeue } from './activation.types.ts';
import type { DebouncedBatch } from './debounce/debounce.service.ts';

/** the activations that start a turn from the queue rather than from the post that arrived (§5.2) */
type DrainKind = Extract<ActivationKind, 'drain' | 'handoff' | 'resync' | 'sweep'>;

/** what a turn about to run was activated by and on (§8.3), the lane it holds, and what else it absorbed */
type TurnStart = {
  readonly activationKind: ActivationKind;
  /** §4.4 — the fragments naming nobody the debounce folded in, for the turn's trace */
  readonly batchedFragmentIds?: readonly string[];
  readonly channelId: string;
  readonly drainedFromPostId?: string;
  /** §5.2 — the bound of a drain's first take: the moment it chose its trigger, not the assembly's start */
  readonly firstTakeBefore?: Date;
  readonly lock: LockHandle;
  readonly triggeringPostId: string;
};

/** §5.2 — the take a turn's assemblies call, and the turn it stamped rows with, which a runner that threw never reports */
type QueueTaker = {
  readonly take: (turnId: string, enqueuedBefore: Date) => Promise<readonly string[]>;
  readonly takenBy: () => string | undefined;
};

/**
 * §7.1 — the exits that allow progress: a completion, a person's act (a stop, a kill, a denial, the
 * denial that exhausts a budget), or an exhaustion, which is never retried. Each consumes what the
 * turn took and lets the queue drain. After a provider outage or rejection, semantic error,
 * side-effect ambiguity, or delivery failure what the turn took is returned to the queue: a drain
 * would start a turn that inherits the same failure, looping until the hourly ceiling halts
 * everything.
 */
const PROGRESS_EXITS: ReadonlySet<TurnStatus> = new Set<TurnStatus>([
  'budget_exhausted',
  'completed',
  'context_exhausted',
  'denied',
  'killed',
  'stopped'
]);

const laneKey = (lane: QueueLane): string => `${lane.agentUsername}\n${lane.channelId}`;

/**
 * The single ingestion path: record → classify → address → debounce → lock → run. This is the only
 * module that both starts turns and reacts to their ending, which is what keeps the graph acyclic —
 * when a turn ends, activation settles what it took from the queue, releases the lock and drains.
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
    private readonly turnRunner: TurnRunner,
    private readonly turnsService: TurnsService
  ) {}

  /**
   * §7.3 — the rows an abandoned turn that had effects took are consumed, as at any exit that allows
   * progress: a fresh turn could not see what it called. Each unit it leaves open is named in the
   * boot notice instead.
   */
  async consumeWithEffects(turns: readonly TurnWithEffects[]): Promise<void> {
    for (const turn of turns) {
      await this.queueService.consume(turn.turnId);
    }
  }

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
    await this.runTurn(profile, {
      activationKind: 'trigger',
      channelId,
      lock,
      triggeringPostId: posted.value.postId
    });
  }

  /** the agent stays on the signature — never re-derived from the roster cache (§4.5) */
  async onPost(profile: AgentProfile, post: ObservedPost): Promise<void> {
    const inserted = await this.conversationsService.record(post);
    if (post.authorKind === 'system' && (await this.triggersService.wasAnnouncedBy(post.id))) {
      return;
    }
    if (this.multiMentionPolicy.refuses(post)) {
      if (inserted) {
        this.loggingService.log(
          `refused post ${post.id} in ${post.channelId}: it addresses more than one agent (§4.5)`
        );
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
      // §4.4 — a fragment rarely repeats the mention, so a post addressing nobody continues a
      // sentence rather than starting a request; one addressing a peer is a request being made.
      // Whichever of the two is live takes a fragment; neither creates itself, so an unaddressed
      // post in a quiet channel stays inert.
      const namesNobody = this.multiMentionPolicy.addresseesOf(post).length === 0;
      if (namesNobody) {
        this.offerToLiveTurn(profile, post);
      }
      if (this.debounceService.touch(batch, namesNobody ? post.id : undefined)) {
        this.signalTyping(profile, post.channelId);
      }
      return;
    }
    if (!activatesOnArrival(post)) {
      return;
    }
    if (this.channelLockService.isBusy(profile.username, post.channelId)) {
      await this.enqueueBusy(profile, post, 'busy');
      return;
    }
    this.signalTyping(profile, post.channelId);
    this.debounceService.schedule(batch, post.id, (debounced) => void this.activate(profile, post, debounced));
  }

  /**
   * §5.2 — posts a reconnect recovered. They are queued rather than activated: a gap holds an
   * unknown number of posts, and ten missed mentions must become one turn rather than ten, which is
   * what the queue is for. Draining happens once per affected channel, after everything is in, so
   * the turn that answers takes all of it. Unaddressed posts are recorded and reach the next turn as
   * ordinary history.
   */
  async onResynced(profile: AgentProfile, posts: readonly ObservedPost[]): Promise<void> {
    const queuedChannelIds = new Set<string>();
    for (const post of posts) {
      if (await this.queueIfAddressed(profile, post)) {
        queuedChannelIds.add(post.channelId);
      }
    }
    for (const channelId of queuedChannelIds) {
      await this.drainQueue(profile, channelId, 'resync');
    }
  }

  /**
   * §7.3 — a deferred hand-off lives only in the turn deferring it (§5.2), so for each turn a restart
   * abandoned it is recomputed from the store: each post the turn addressed to its colleague that no
   * turn of that colleague in the channel has started since goes into the colleague's queue, for the
   * boot sweep to drain. Who a post addressed is read against the roster (§4.5), so this runs only
   * once the roster has reconciled. Returns how many colleagues were queued.
   */
  async requeueDeferred(turns: readonly AbandonedTurn[]): Promise<number> {
    let requeued = 0;
    for (const turn of turns) {
      const deferred = await this.findUnreleasedHandoff(turn);
      if (deferred === undefined) {
        continue;
      }
      const lane = { agentUsername: deferred.addresseeUsername, channelId: turn.channelId };
      for (const postId of deferred.postIds) {
        await this.queueService.insert(lane, postId);
      }
      requeued += 1;
    }
    return requeued;
  }

  /**
   * §7.3 — each abandoned turn that had no effects runs again: what it took goes back to the queue
   * and the post that started it is queued, or the trigger it was announced by goes back to be
   * announced, for the boot sweep to answer. After an unclean stop, a turn that made a completion
   * may be what took the process down, so each of its posts goes back at most once: one already
   * returned is left out, and named. A post the store does not hold, whose author is unknown, stays out.
   */
  async requeueWithoutEffects(
    turns: readonly TurnWithoutEffects[],
    { unclean }: { readonly unclean: boolean }
  ): Promise<RestartRequeue> {
    const notQueuedPostIds: string[] = [];
    const unannouncedTriggerIds: string[] = [];
    let requeuedTurns = 0;
    for (const turn of turns) {
      const bounded = unclean && turn.madeCompletion;
      const { dropped, returned } = bounded
        ? await this.queueService.returnTakenOnce(turn.turnId)
        : { dropped: [], returned: await this.queueService.returnTaken(turn.turnId) };
      notQueuedPostIds.push(...dropped);
      const trigger = turn.triggeringPostId;
      let queuedTrigger = false;
      if (trigger !== undefined && !dropped.includes(trigger)) {
        const source = await this.conversationsService.findActivationSource(trigger);
        if (source?.authorKind === 'system') {
          const reannounced = await this.triggersService.reannounceAfterRestart(trigger, { bounded });
          queuedTrigger = reannounced?.kind === 'released';
          if (reannounced?.kind === 'spent') {
            unannouncedTriggerIds.push(reannounced.triggerId);
          }
        } else if (source !== undefined) {
          const lane = { agentUsername: turn.agentUsername, channelId: turn.channelId };
          await this.queueService.insert(lane, trigger, { returnedOnce: bounded });
          queuedTrigger = true;
        }
      }
      if (queuedTrigger || returned.length > 0) {
        requeuedTurns += 1;
      }
    }
    return { notQueuedPostIds, requeuedTurns, unannouncedTriggerIds };
  }

  /** the boot and /resume sweep: standing queues drain and held triggers flush (§7.3, §7.4) */
  async sweep(): Promise<void> {
    const lanes = uniqBy(await this.queueService.listStanding(), laneKey);
    for (const lane of lanes) {
      const profile = this.agentRegistry.get(lane.agentUsername);
      if (!profile) {
        this.loggingService.warn(`dropping a queue entry for unknown agent "${lane.agentUsername}"`);
        continue;
      }
      void this.drainQueue(profile, lane.channelId, 'sweep');
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

  /**
   * §4.4 — a post the debounce absorbed that names the agent is queued before the turn starts, so
   * the turn's first take takes it and a failure returns it; during a halt the post that opened the
   * batch is queued too, and simply starts no turn (§7.4).
   */
  private async activate(profile: AgentProfile, post: ObservedPost, debounced: DebouncedBatch): Promise<void> {
    if (post.authorKind !== 'system') {
      for (const postId of debounced.addressedPostIds) {
        await this.queueService.insert({ agentUsername: profile.username, channelId: post.channelId }, postId);
      }
    }
    if (this.haltService.isHalted()) {
      await this.enqueueBusy(profile, post, 'halted');
      return;
    }
    const lock = this.channelLockService.acquire(profile.username, post.channelId);
    if (!lock) {
      await this.enqueueBusy(profile, post, 'busy');
      return;
    }
    await this.admitAndRun(profile, post, lock, debounced);
  }

  /**
   * §5.2 — the colleague an agent's turn addressed, started once that turn ends or parks. Each
   * deferred post joins the colleague's queue first, so a halt, the ceiling or a busy colleague
   * leaves it standing rather than lost, and the drain runs §7.4 admission on it as on any other.
   * Nothing awaits this: the turn that released it must not wait on its colleague's.
   */
  private async activateDeferred(channelId: string, deferred: DeferredHandoff): Promise<void> {
    const profile = this.agentRegistry.get(deferred.addresseeUsername);
    if (!profile) {
      this.loggingService.warn(`dropping a deferred hand-off for unknown agent "${deferred.addresseeUsername}"`);
      return;
    }
    try {
      for (const postId of deferred.postIds) {
        await this.queueService.insert({ agentUsername: profile.username, channelId }, postId);
      }
      if (this.channelLockService.isBusy(profile.username, channelId)) {
        for (const postId of deferred.postIds) {
          this.logQueued(profile, channelId, postId, 'handoff');
          await this.acknowledgeQueued(profile.username, postId);
        }
        return;
      }
      await this.drainQueue(profile, channelId, 'handoff');
    } catch (error) {
      this.loggingService.error(
        new Error(`failed to start "${profile.username}" in ${channelId} from a deferred hand-off`, { cause: error })
      );
    }
  }

  /** the ceiling-refused post takes the queue path, where enqueueBusy already enforces §5.2 */
  private async admitAndRun(
    profile: AgentProfile,
    post: ObservedPost,
    lock: LockHandle,
    debounced: DebouncedBatch
  ): Promise<void> {
    if (!(await this.haltService.admitTurnStart())) {
      lock.release();
      await this.enqueueBusy(profile, post, 'ceiling');
      return;
    }
    // §5.2 — the turn's first take absorbs whatever a failed exit left standing, which a drain would
    // otherwise answer again once this turn ends; the earliest such post is on its record
    const batched = new Set(debounced.addressedPostIds);
    const standing = await this.queueService.listUntaken({
      agentUsername: profile.username,
      channelId: post.channelId
    });
    await this.runTurn(profile, {
      activationKind: 'addressed',
      batchedFragmentIds: debounced.fragmentIds,
      channelId: post.channelId,
      drainedFromPostId: standing.find((entry) => !batched.has(entry.postId))?.postId,
      lock,
      triggeringPostId: post.id
    });
  }

  /**
   * §5.2 — under the lock, the queue's newest post a person wrote, else its earliest, and the moment
   * it was chosen, which bounds the drain's first take. A failure to read the posts falls back to
   * the earliest row rather than throws, since the lock is held.
   */
  private async chooseDrainStart(
    profile: AgentProfile,
    lane: QueueLane
  ): Promise<undefined | { chosenAt: Date; earliestPostId: string; triggeringPostId: string }> {
    const standing = await this.queueService.listUntaken(lane);
    const chosenAt = new Date();
    const [first] = standing;
    if (first === undefined) {
      return undefined;
    }
    try {
      const posts = await this.conversationsService.describeQueued(standing.map((entry) => entry.postId));
      return {
        chosenAt,
        earliestPostId: findEarliestQueued(posts)?.id ?? first.postId,
        triggeringPostId: chooseDrainTrigger(posts)?.id ?? first.postId
      };
    } catch (error) {
      this.loggingService.error(
        new Error(`failed to find the newest person's post to "${profile.username}" in ${lane.channelId}`, {
          cause: error
        })
      );
      return { chosenAt, earliestPostId: first.postId, triggeringPostId: first.postId };
    }
  }

  /**
   * §7.4 — a lane holding only colleagues' posts is cleared once the chain limit refuses a turn
   * from it, since each would be refused again at every sweep. A person's post keeps the lane
   * standing, and the caller drains it, since a person's post starts a fresh chain. Logged rather
   * than thrown: the lock must be released whatever happens.
   */
  private async clearRefusedLane(profile: AgentProfile, channelId: string): Promise<boolean> {
    const lane = { agentUsername: profile.username, channelId };
    try {
      const standing = await this.queueService.listUntaken(lane);
      if (standing.length === 0) {
        return false;
      }
      const posts = await this.conversationsService.describeQueued(standing.map((entry) => entry.postId));
      if (posts.some((queued) => queued.authorKind === 'human')) {
        return true;
      }
      await this.queueService.discard(lane);
      this.loggingService.warn(
        `dropped the queue for "${profile.username}" in ${channelId}: the chain limit refused the colleagues' posts it held`
      );
      return false;
    } catch (error) {
      this.loggingService.error(
        new Error(`failed to settle the queue for "${profile.username}" in ${channelId}`, { cause: error })
      );
      return false;
    }
  }

  /**
   * §5.2 — the take each assembly of the turn calls: every untaken row of the lane queued at or
   * before the bound, except that a drain's first take is bounded by when it chose its trigger, so
   * a person's post queued after that choice waits for a turn of its own rather than being answered
   * under a colleague's authority. It remembers the turn it stamped rows with.
   */
  private createQueueTaker(lane: QueueLane, firstTakeBefore: Date | undefined): QueueTaker {
    let firstBound = firstTakeBefore;
    let takenBy: string | undefined;
    return {
      take: (turnId, enqueuedBefore) => {
        const bound = firstBound ?? enqueuedBefore;
        firstBound = undefined;
        takenBy = turnId;
        return this.queueService.take(turnId, lane, bound);
      },
      takenBy: () => takenBy
    };
  }

  /**
   * Halt-gated: a drain during a halt would start a turn no human has sanctioned (§7.4). Admission
   * is checked before the trigger is chosen, so a refusal leaves every row standing as it was.
   */
  private async drainQueue(profile: AgentProfile, channelId: string, activationKind: DrainKind): Promise<void> {
    if (this.haltService.isHalted()) {
      return;
    }
    const lane = { agentUsername: profile.username, channelId };
    if ((await this.queueService.listUntaken(lane)).length === 0) {
      return;
    }
    const lock = this.channelLockService.acquire(profile.username, channelId);
    if (!lock) {
      // A4: never give up silently — the rows stand until whoever holds the lock finishes and drains
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
    const start = await this.chooseDrainStart(profile, lane);
    if (!start) {
      this.loggingService.warn(
        `found the queue for "${profile.username}" in ${channelId} already drained by a concurrent activation`
      );
      lock.release();
      return;
    }
    await this.runTurn(profile, {
      activationKind,
      channelId,
      drainedFromPostId: start.earliestPostId,
      firstTakeBefore: start.chosenAt,
      lock,
      triggeringPostId: start.triggeringPostId
    });
  }

  /**
   * §4.4, §5.2 — a post that is work for an agent that cannot start a turn now is queued and
   * acknowledged. Behind a busy lane it is offered to the running turn too, after its row exists,
   * so the turn that absorbs it takes the row when it reassembles and a failure returns it; a post
   * absorbed that way carries no 👀, since the turn answering it is the acknowledgement.
   */
  private async enqueueBusy(
    profile: AgentProfile,
    post: ObservedPost,
    reason: Exclude<keyof typeof QUEUE_REASONS, 'handoff'>
  ): Promise<void> {
    if (post.authorKind === 'system') {
      this.loggingService.warn(
        `dropped a system bot post addressed to a busy "${profile.username}" — nothing from the system bot is queued (§5.2)`
      );
      return;
    }
    await this.queueService.insert({ agentUsername: profile.username, channelId: post.channelId }, post.id);
    if (reason === 'busy' && this.offerToLiveTurn(profile, post)) {
      this.loggingService.log(
        `folded post ${post.id} into the turn of "${profile.username}" in ${post.channelId} that its author started (§4.4)`
      );
      return;
    }
    this.logQueued(profile, post.channelId, post.id, reason);
    await this.acknowledgeQueued(profile.username, post.id);
  }

  /** §7.3 — each post of the turn addressing its one colleague (§4.5) that no turn of that colleague here started after */
  private async findUnreleasedHandoff(turn: AbandonedTurn): Promise<DeferredHandoff | undefined> {
    const spoken = await this.conversationsService.listSpokenBy(turn.turnId);
    const addressing = spoken.flatMap((post) => {
      const addresseeUsername = this.multiMentionPolicy.findAddressee({
        authorUsername: turn.agentUsername,
        channelId: turn.channelId,
        message: post.message
      });
      return addresseeUsername === undefined ? [] : [{ addresseeUsername, post }];
    });
    const first = addressing[0];
    if (first === undefined) {
      return undefined;
    }
    const since = await this.turnsService.findLatestStartIn(first.addresseeUsername, turn.channelId);
    const pending = addressing.filter(({ addresseeUsername, post }) => {
      return addresseeUsername === first.addresseeUsername && (since === undefined || post.observedAt > since);
    });
    return pending.length === 0
      ? undefined
      : { addresseeUsername: first.addresseeUsername, postIds: pending.map(({ post }) => post.id) };
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

  /** the activation decision that starts no turn yet, one log line each */
  private logQueued(
    profile: AgentProfile,
    channelId: string,
    postId: string,
    reason: keyof typeof QUEUE_REASONS
  ): void {
    this.loggingService.log(
      `queued post ${postId} for "${profile.username}" in ${channelId}: ${QUEUE_REASONS[reason]}`
    );
  }

  /**
   * §4.4 — a post that missed the window folds into the turn already answering its author, which
   * has not yet acted on its first completion. A post naming nobody is only offered, and queues
   * nothing; a post naming the agent is queued first (enqueueBusy), so absorbing it survives a failure.
   */
  private offerToLiveTurn(profile: AgentProfile, post: ObservedPost): boolean {
    return this.turnFoldRegistry.offer({
      agentUsername: profile.username,
      authorUsername: post.authorUsername,
      channelId: post.channelId,
      postId: post.id
    });
  }

  /** whether this post is work for the agent, and if so, the row that says so (§5.2) */
  private async queueIfAddressed(profile: AgentProfile, post: ObservedPost): Promise<boolean> {
    if (!this.isWorkFor(profile, post)) {
      return false;
    }
    await this.enqueueBusy(profile, post, 'resync');
    return true;
  }

  /**
   * §7.4 — an activation the chain limit refuses is refused, not deferred: it took nothing, and the
   * system bot says so under its post. A lane of colleagues' posts is cleared (clearRefusedLane).
   */
  private async refuseChainTurn(
    profile: AgentProfile,
    input: TurnStart,
    refusal: TurnOpenFailure.ChainFull
  ): Promise<void> {
    this.loggingService.log(
      `refused a turn for "${profile.username}" in ${input.channelId} from post ${input.triggeringPostId}: its chain already holds ${refusal.count} of ${refusal.limit} turns (§7.4)`
    );
    let personWaiting = false;
    try {
      personWaiting = await this.clearRefusedLane(profile, input.channelId);
    } finally {
      input.lock.release();
    }
    await this.notificationsService.notify({
      agentUsername: profile.username,
      channelId: input.channelId,
      kind: 'chain-limit-refusal',
      limit: refusal.limit
    });
    if (personWaiting) {
      await this.drainQueue(profile, input.channelId, 'drain');
    }
  }

  private async runTurn(profile: AgentProfile, input: TurnStart): Promise<void> {
    const lane = { agentUsername: profile.username, channelId: input.channelId };
    const startedAt = new Date();
    // §5.2, RC6 — a turn a trigger started takes nothing: rows standing in an idle channel wait for a person
    const taker = input.activationKind === 'trigger' ? undefined : this.createQueueTaker(lane, input.firstTakeBefore);
    let ended: TurnOutcome | undefined;
    try {
      const source = await this.conversationsService.findActivationSource(input.triggeringPostId);
      const outcome = await this.turnRunner.run({
        activationKind: input.activationKind,
        batchedFragmentIds: input.batchedFragmentIds,
        chainLength: toActivationChainLength(source),
        channelId: input.channelId,
        depth: toActivationDepth(source, profile.username),
        drainedFromPostId: input.drainedFromPostId,
        foldAuthorUsername: toFoldAuthorUsername(source),
        profile,
        releaseDeferredHandoff: (deferred) => void this.activateDeferred(input.channelId, deferred),
        rootPostId: toActivationRootPostId(source, input.triggeringPostId),
        takeQueued: taker?.take,
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
    let personWaiting = false;
    try {
      personWaiting = await this.settleTaken(profile, input, {
        progressed,
        since: startedAt,
        turnId: ended?.turnId ?? taker?.takenBy()
      });
    } finally {
      input.lock.release();
    }
    if (progressed || personWaiting) {
      await this.drainQueue(profile, input.channelId, 'drain');
    }
    if (progressed) {
      await this.flushTriggersIfIdle(input.channelId);
    }
  }

  /**
   * §5.2, §7.1 — under the lock, what the turn took from the queue: an exit that allows progress
   * consumes it, folded posts included; any other returns it and queues the post the turn started
   * from, unless the system bot wrote it (§5.2). Returns whether a person's post was queued while
   * the failed turn ran: the 👀 on it promised a read and the person has already spoken, so it drains
   * at once, where a colleague's waits for a person like any other standing row. Logged rather than
   * thrown: the lock must be released whatever happens.
   */
  private async settleTaken(
    profile: AgentProfile,
    input: TurnStart,
    exit: { progressed: boolean; since: Date; turnId: string | undefined }
  ): Promise<boolean> {
    const lane = { agentUsername: profile.username, channelId: input.channelId };
    try {
      if (exit.progressed) {
        if (exit.turnId !== undefined) {
          await this.queueService.consume(exit.turnId);
        }
        return false;
      }
      const returned = new Set(exit.turnId === undefined ? [] : await this.queueService.returnTaken(exit.turnId));
      const source = await this.conversationsService.findActivationSource(input.triggeringPostId);
      if (source !== undefined && source.authorKind !== 'system') {
        await this.queueService.insert(lane, input.triggeringPostId);
      }
      // what the failed turn took is what it failed on, so only a post it never took is a next post
      const arrived = (await this.queueService.listUntaken(lane)).filter((entry) => {
        return entry.enqueuedAt >= exit.since && !returned.has(entry.postId) && entry.postId !== input.triggeringPostId;
      });
      if (arrived.length === 0) {
        return false;
      }
      const posts = await this.conversationsService.describeQueued(arrived.map((entry) => entry.postId));
      return posts.some((queued) => queued.authorKind === 'human');
    } catch (error) {
      this.loggingService.error(
        new Error(`failed to settle the queue for "${profile.username}" in ${input.channelId}`, { cause: error })
      );
      return false;
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
