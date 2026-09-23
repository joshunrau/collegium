import { Result } from '@collegium/core/utils';
import { Injectable } from '@nestjs/common';

import { AgentRegistry } from '@/agents/agents.registry.ts';
import { ChannelLockService } from '@/channels/locks/channel-lock.service.ts';
import { MultiMentionPolicy } from '@/channels/refusals/multi-mention.policy.ts';
import { RosterService } from '@/channels/roster/roster.service.ts';
import { ConfigService } from '@/config/config.service.ts';
import { ConversationsService } from '@/conversations/conversations.service.ts';
import type { EpisodeBoundary } from '@/conversations/conversations.types.ts';
import { LoggingService } from '@/logging/logging.service.ts';
import { InjectModel } from '@/prisma/prisma.decorators.ts';
import type { Model, TransactionClient } from '@/prisma/prisma.types.ts';
import { createRecordId } from '@/prisma/prisma.utils.ts';
import { renderReference } from '@/utils/reference.utils.ts';

import { CounterpartStateService } from './counterparts/counterpart-state.service.ts';
import { PostSightingsRegistry } from './sightings/post-sightings.registry.ts';
import {
  ASSIGNEE_TARGETS,
  awaitsVerdictOnReport,
  CREATOR_TARGETS,
  findTransitionRefusal,
  holdsReportTool,
  isOpenUnit,
  OPEN_STATES,
  renderAssignmentPost,
  renderClosePost,
  renderHumanCancellationPost,
  renderReportPost,
  statesThatMayReach
} from './tasks.utils.ts';

import type {
  LatestChange,
  OpenUnitSummary,
  PreparedTransition,
  PreparedUnit,
  TaskFailure,
  UnitView,
  WorkUnit
} from './tasks.types.ts';

type AssignInput = {
  readonly actingAgentUsername: string;
  readonly assigneeUsername: string;
  readonly channelId: string;
  readonly context: string;
  readonly criteria: string;
  /** the creator's open-unit cap, from the acting agent's own settings */
  readonly openUnitCap: number;
  readonly outcome: string;
  readonly turnId: string;
};

type TransitionInput = {
  readonly actingAgentUsername: string;
  readonly channelId: string;
  readonly reference: string;
};

/** what a verb rendered but has not written: the post text the framework publishes, and what to commit once it has landed */
type Prepared<TPrepared> = { readonly prepared: TPrepared; readonly text: string };

/** a verb whose post addresses a peer, and the one it addresses (§4.5) */
type Addressed<TPrepared> = Prepared<TPrepared> & { readonly addressee: string };

/** §3.15 — fixed text, never the model's: a report written now would come from the context that just ran out */
const CONTEXT_EXHAUSTED_REASON = 'context exhausted';

/**
 * §3.15 — the record of delegated work. Every verb is two methods: `prepare*` validates against
 * what it reads and renders the post, writing nothing; `commit*` writes, and is reached only
 * through the post's `onPublished`, so a row never exists without the post that announced it.
 */
@Injectable()
export class TasksService {
  private readonly chainLengthLimit: number;
  private readonly delegationDepthLimit: number;

  constructor(
    private readonly agentRegistry: AgentRegistry,
    private readonly channelLockService: ChannelLockService,
    configService: ConfigService,
    private readonly conversationsService: ConversationsService,
    private readonly counterpartStateService: CounterpartStateService,
    private readonly loggingService: LoggingService,
    private readonly multiMentionPolicy: MultiMentionPolicy,
    private readonly postSightingsRegistry: PostSightingsRegistry,
    private readonly rosterService: RosterService,
    @InjectModel('Turn') private readonly turns: Model<'Turn'>,
    @InjectModel('WorkUnit') private readonly units: Model<'WorkUnit'>
  ) {
    const limits = configService.get('turns');
    this.chainLengthLimit = limits.chainLengthLimit;
    this.delegationDepthLimit = limits.delegationDepthLimit;
  }

  /** the row is born pointing at its post: origin and latest are the same post until a report lands */
  async commitAssign(prepared: PreparedUnit, postId: string): Promise<void> {
    await this.units.create({
      data: { ...prepared, lastPostId: postId, originPostId: postId, state: 'assigned' }
    });
  }

  /**
   * The transition is re-checked inside the write itself: a row that moved between the read and
   * the post landing is left exactly as it is, and the post stays in the channel as an honest
   * record of what was said (§3.15).
   */
  async commitTransition(prepared: PreparedTransition, postId: string): Promise<void> {
    const closing =
      prepared.to === 'cancelled' || prepared.to === 'done'
        ? { closedAt: new Date(), closedByUsername: prepared.closedByUsername, verdict: prepared.verdict }
        : {};
    const moved = await this.units.updateMany({
      data: { lastPostId: postId, state: prepared.to, ...closing },
      where: { id: prepared.unitId, state: { in: statesThatMayReach(prepared.to) } }
    });
    if (moved.count === 0) {
      this.loggingService.warn(
        `unit ${renderReference(prepared.unitId)} moved before its transition to ${prepared.to} landed; the post stands, the row is unchanged`
      );
    }
  }

  /** §8.5 — units are control state pointing at posts (§3.15), and the posts they point at are going */
  async eraseBefore(channelId: string, boundary: EpisodeBoundary, transaction: TransactionClient): Promise<void> {
    await transaction.workUnit.deleteMany({ where: { channelId, createdAt: { lt: boundary.eventsAfter } } });
  }

  /** §3.15 — the unit still assigned to this agent here whose assignment post started its turn */
  async findServedUnit(input: {
    agentUsername: string;
    channelId: string;
    triggeringPostId: string | undefined;
  }): Promise<undefined | WorkUnit> {
    if (input.triggeringPostId === undefined) {
      return undefined;
    }
    const unit = await this.units.findFirst({
      where: {
        assigneeUsername: input.agentUsername,
        channelId: input.channelId,
        originPostId: input.triggeringPostId,
        state: 'assigned'
      }
    });
    return unit ?? undefined;
  }

  /**
   * §3.15 — the unit a turn of this agent here was working, or nothing: of the units it holds
   * assigned in the channel, the one whose assignment post started the turn, else the only one.
   * With several and none that started the turn, it does not guess which it was.
   */
  async findWorkedUnit(input: {
    agentUsername: string;
    channelId: string;
    triggeringPostId: string | undefined;
  }): Promise<undefined | WorkUnit> {
    const served = await this.findServedUnit(input);
    if (served) {
      return served;
    }
    const assigned = await this.units.findMany({
      take: 2,
      where: { assigneeUsername: input.agentUsername, channelId: input.channelId, state: 'assigned' }
    });
    return assigned.length === 1 ? assigned[0] : undefined;
  }

  /** open units where the agent is creator or assignee, in this channel, oldest first, each with where its counterpart stands (§3.15) */
  async listOpenFor(input: { agentUsername: string; channelId: string }): Promise<OpenUnitSummary[]> {
    const rows = await this.units.findMany({
      orderBy: { createdAt: 'asc' },
      where: {
        channelId: input.channelId,
        OR: [{ creatorUsername: input.agentUsername }, { assigneeUsername: input.agentUsername }],
        state: { in: [...OPEN_STATES] }
      }
    });
    return Promise.all(
      rows.filter(isOpenUnit).map(async (row) => ({
        assigneeUsername: row.assigneeUsername,
        counterpart: await this.counterpartStateService.readFor(row, input.agentUsername),
        createdAt: row.createdAt,
        creatorUsername: row.creatorUsername,
        outcome: row.outcome,
        reference: renderReference(row.id),
        state: row.state
      }))
    );
  }

  /**
   * Refused, in order: handing to oneself, to a peer absent from the channel (§4.5's inert-text
   * rule cannot be defeated here), to one that could not report back through a unit, past the
   * creator's cap, and at either §7.4 limit — refused rather than stripped, since a stripped
   * assignment would announce a hand-off to a peer never activated (§3.15).
   */
  async prepareAssign(input: AssignInput): Promise<Result<Addressed<PreparedUnit>, TaskFailure.AssignRefused>> {
    if (input.assigneeUsername === input.actingAgentUsername) {
      return Result.err({ kind: 'self-assignment' });
    }
    const present = this.rosterService.listAgentsIn(input.channelId);
    if (!present.some((agent) => agent.username === input.assigneeUsername)) {
      return Result.err({ assigneeUsername: input.assigneeUsername, kind: 'assignee-absent' });
    }
    if (!holdsReportTool(this.agentRegistry.get(input.assigneeUsername)?.tools ?? [])) {
      return Result.err({ assigneeUsername: input.assigneeUsername, kind: 'assignee-cannot-report' });
    }
    const open = await this.units.count({
      where: { channelId: input.channelId, creatorUsername: input.actingAgentUsername, state: { in: [...OPEN_STATES] } }
    });
    if (open >= input.openUnitCap) {
      return Result.err({ cap: input.openUnitCap, kind: 'cap-reached' });
    }
    const limit = await this.atLoopLimit(input.turnId);
    if (limit) {
      return Result.err({ kind: limit });
    }
    const prepared: PreparedUnit = {
      assigneeUsername: input.assigneeUsername,
      channelId: input.channelId,
      context: input.context,
      creatorUsername: input.actingAgentUsername,
      criteria: input.criteria,
      id: createRecordId(),
      outcome: input.outcome
    };
    return Result.ok({ addressee: prepared.assigneeUsername, prepared, text: renderAssignmentPost(prepared) });
  }

  /** §8.4 — a person may cancel a unit its creator will never reach; the post is the system bot's, and names no agent with an @ */
  async prepareCancelOnHumanAuthority(input: {
    agentUsername: string;
    byUsername: string;
    channelId: string;
    reference: string;
  }): Promise<Result<Prepared<PreparedTransition>, TaskFailure.StateRefused | TaskFailure.Unresolved>> {
    const unit = await this.read(input.agentUsername, input.channelId, input.reference);
    if (!unit.success) {
      return unit;
    }
    const refused = findTransitionRefusal(unit.value, 'cancelled');
    if (refused) {
      return Result.err(refused);
    }
    return Result.ok({
      prepared: { closedByUsername: input.byUsername, to: 'cancelled', unitId: unit.value.id },
      text: renderHumanCancellationPost(
        { ...unit.value, outcome: this.multiMentionPolicy.stripAgentMentions(unit.value.outcome) },
        input.byUsername,
        {
          assignee: this.agentRegistry.displayNameOf(unit.value.assigneeUsername),
          creator: this.agentRegistry.displayNameOf(unit.value.creatorUsername)
        }
      )
    });
  }

  /**
   * §3.15 — refused, beyond the creator and the transition: while a turn of the assignee that opened
   * since the assignment runs here, since it may be writing the report the verdict would judge; and
   * from review or blocked, until the closing turn has read the report.
   */
  async prepareClose(
    input: TransitionInput & { to: (typeof CREATOR_TARGETS)[number]; turnId: string; verdict: string }
  ): Promise<Result<Prepared<PreparedTransition>, TaskFailure.CloseRefused | TaskFailure.Unresolved>> {
    const read = await this.read(input.actingAgentUsername, input.channelId, input.reference);
    if (!read.success) {
      return read;
    }
    const unit = read.value;
    if (unit.creatorUsername !== input.actingAgentUsername) {
      return Result.err({ creatorUsername: unit.creatorUsername, kind: 'not-the-creator' });
    }
    const refused = findTransitionRefusal(unit, input.to);
    if (refused) {
      return Result.err(refused);
    }
    const reference = renderReference(unit.id);
    if (
      unit.state === 'assigned' &&
      this.channelLockService.isBusyWithTurnOpenedAfter(unit.assigneeUsername, unit.channelId, unit.createdAt)
    ) {
      return Result.err({ assigneeUsername: unit.assigneeUsername, kind: 'assignee-working', reference });
    }
    if (awaitsVerdictOnReport(unit.state) && !this.postSightingsRegistry.hasSeen(input.turnId, unit.lastPostId)) {
      return Result.err({ kind: 'report-unread', reference });
    }
    return Result.ok({
      prepared: { closedByUsername: input.actingAgentUsername, to: input.to, unitId: unit.id, verdict: input.verdict },
      text: renderClosePost(unit, input.to, input.verdict)
    });
  }

  /** §3.15 — the report the framework makes for a turn that ran out of context, on the unit it was working, or nothing */
  async prepareExhaustionReport(input: {
    agentUsername: string;
    channelId: string;
    triggeringPostId: string | undefined;
  }): Promise<Addressed<PreparedTransition> | undefined> {
    const unit = await this.findWorkedUnit(input);
    if (!unit) {
      return undefined;
    }
    return {
      addressee: unit.creatorUsername,
      prepared: { to: 'blocked', unitId: unit.id },
      text: renderReportPost(unit, 'blocked', CONTEXT_EXHAUSTED_REASON)
    };
  }

  async prepareReport(
    input: TransitionInput & { summary: string; to: (typeof ASSIGNEE_TARGETS)[number] }
  ): Promise<Result<Addressed<PreparedTransition>, TaskFailure.StateRefused | TaskFailure.Unresolved>> {
    const unit = await this.read(input.actingAgentUsername, input.channelId, input.reference);
    if (!unit.success) {
      return unit;
    }
    if (unit.value.assigneeUsername !== input.actingAgentUsername) {
      return Result.err({ assigneeUsername: unit.value.assigneeUsername, kind: 'not-the-assignee' });
    }
    const refused = findTransitionRefusal(unit.value, input.to);
    if (refused) {
      return Result.err(refused);
    }
    return Result.ok({
      addressee: unit.value.creatorUsername,
      prepared: { to: input.to, unitId: unit.value.id },
      text: renderReportPost(unit.value, input.to, input.summary)
    });
  }

  /** by reference or full id, among the units the agent is a party to in this channel; anyone else's is simply absent (§3.15) */
  async read(
    agentUsername: string,
    channelId: string,
    reference: string
  ): Promise<Result<WorkUnit, TaskFailure.Unresolved>> {
    const matches = await this.units.findMany({
      take: 2,
      where: {
        channelId,
        id: { startsWith: reference },
        OR: [{ creatorUsername: agentUsername }, { assigneeUsername: agentUsername }]
      }
    });
    if (matches.length === 1) {
      return Result.ok(matches[0]!);
    }
    return Result.err({ kind: matches.length === 0 ? 'not-found' : 'ambiguous', reference });
  }

  /** §3.15 — tasks::read: the unit, where its counterpart stands while it is open, and the post of its latest change */
  async readView(input: {
    agentUsername: string;
    channelId: string;
    reference: string;
  }): Promise<Result<UnitView, TaskFailure.Unresolved>> {
    const read = await this.read(input.agentUsername, input.channelId, input.reference);
    if (!read.success) {
      return read;
    }
    const unit = read.value;
    return Result.ok({
      counterpart: isOpenUnit(unit) ? await this.counterpartStateService.readFor(unit, input.agentUsername) : undefined,
      latestChange: await this.readLatestChange(unit),
      unit
    });
  }

  /** §7.4 — the acting turn's own depth, and its chain counted by root as the runner counts it */
  private async atLoopLimit(turnId: string): Promise<'chain-limit' | 'depth-limit' | undefined> {
    const turn = await this.turns.findUnique({ select: { depth: true, rootPostId: true }, where: { id: turnId } });
    if (!turn) {
      return undefined;
    }
    if (turn.depth >= this.delegationDepthLimit) {
      return 'depth-limit';
    }
    if (
      turn.rootPostId !== null &&
      (await this.turns.count({ where: { rootPostId: turn.rootPostId } })) >= this.chainLengthLimit
    ) {
      return 'chain-limit';
    }
    return undefined;
  }

  /** the assignment post is the record's own fields; a later post is the report or close the unit last moved by */
  private async readLatestChange(unit: WorkUnit): Promise<LatestChange> {
    if (unit.lastPostId === unit.originPostId) {
      return { kind: 'none' };
    }
    const post = await this.conversationsService.findUnforgotten(unit.lastPostId);
    return post === undefined ? { kind: 'unreadable' } : { kind: 'posted', post };
  }
}
