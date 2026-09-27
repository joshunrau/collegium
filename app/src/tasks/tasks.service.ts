import type { WorkUnitView } from '@collegium/core/plugins';
import { TASKS_TOOLSET_DEF } from '@collegium/core/toolsets';
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
import { PrismaService } from '@/prisma/prisma.service.ts';
import type { Model, TransactionClient } from '@/prisma/prisma.types.ts';
import { createRecordId } from '@/prisma/prisma.utils.ts';
import type { ContextExhaustionCause } from '@/turns/turns.types.ts';
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
  renderContinuationVerdict,
  renderHumanCancellationPost,
  renderReportPost,
  statesThatMayReach
} from './tasks.utils.ts';

import type {
  FollowedUnit,
  LatestChange,
  OpenUnitSummary,
  PreparedTransition,
  PreparedUnit,
  TaskFailure,
  UnitView,
  WorkUnit
} from './tasks.types.ts';

/** a unit's row as it is created: the prepared fields, the link to the unit it follows, and its first post */
type CreatedUnit = Omit<PreparedUnit, 'follows'> & {
  readonly followsId: null | string;
  readonly lastPostId: string;
  readonly originPostId: string;
  readonly state: 'assigned';
};

type AssignInput = {
  readonly actingAgentUsername: string;
  /** the colleagues the creator may hand units to, from its own settings; undefined where it declares none (§3.15) */
  readonly assignees: readonly string[] | undefined;
  readonly assigneeUsername: string;
  readonly channelId: string;
  readonly context: string;
  readonly criteria: string;
  /** the reference of the unit this one continues, which the assignment closes as done (§3.15) */
  readonly follows: string | undefined;
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

/** §3.15 — a close, and whether it leaves the closer no other open unit here, which its result states */
type PreparedClose = Prepared<PreparedTransition> & { readonly leavesNoneOpen: boolean };

/** §3.15 — fixed text, never the model's: a report written now would come from the context that just ran out */
/** §3.15, §7.1 — the blocked report of a unit whose assignee ran out of room, which cannot show what the turn did */
const CONTEXT_EXHAUSTED_REASONS = {
  accumulated: 'context exhausted — the turn’s accumulated context passed its ceiling',
  initial: 'context exhausted — its starting context did not fit its ceiling'
} as const;

const CONTEXT_EXHAUSTED_FOLLOW_UP =
  'What this turn wrote before it stopped is not shown here; check it with your own tools, or continue the unit with follows so its assignee, who sees its own calls, reports it.';

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
    private readonly prismaService: PrismaService,
    private readonly rosterService: RosterService,
    @InjectModel('Turn') private readonly turns: Model<'Turn'>,
    @InjectModel('WorkUnit') private readonly units: Model<'WorkUnit'>
  ) {
    const limits = configService.get('turns');
    this.chainLengthLimit = limits.chainLengthLimit;
    this.delegationDepthLimit = limits.delegationDepthLimit;
  }

  /**
   * §3.15 — a declared assignee that is the agent itself, no configured agent, or one that could
   * never report back is a policy that cannot hold, so boot refuses it rather than every assignment
   */
  assertDeclaredAssigneesCanReport(): void {
    for (const { username } of this.agentRegistry.list()) {
      for (const assignee of this.agentRegistry.settingsFor(TASKS_TOOLSET_DEF, username)?.assignees ?? []) {
        const declared = `agent "${username}" names "${assignee}" in toolSettings.tasks.assignees`;
        if (assignee === username) {
          throw new Error(`${declared}, and an agent does not hand a unit to itself`);
        }
        const profile = this.agentRegistry.get(assignee);
        if (!profile) {
          throw new Error(`${declared}, which is not a configured agent`);
        }
        if (!holdsReportTool(profile.tools)) {
          throw new Error(`${declared}, which holds no tasks::report and so could never report back`);
        }
      }
    }
  }

  /**
   * The row is born pointing at its post: origin and latest are the same post until a report lands.
   * A continuation's post is also the close of the unit it follows, written with it or not at all,
   * and against that unit as it is now: one that moved since stays as it is, as a transition's does.
   * A unit its creator closed as done earlier is only linked: its verdict gains its successor, and
   * a second unit following it rolls back whole, since a unit is followed once.
   */
  async commitAssign(prepared: PreparedUnit, postId: string): Promise<void> {
    const { follows, ...fields } = prepared;
    const data: CreatedUnit = {
      ...fields,
      followsId: follows?.id ?? null,
      lastPostId: postId,
      originPostId: postId,
      state: 'assigned'
    };
    if (follows === null) {
      await this.units.create({ data });
      return;
    }
    const linked = follows.closes
      ? await this.closeFollowed(data, follows, postId)
      : await this.linkFollowed(data, follows);
    if (!linked) {
      this.loggingService.warn(
        `unit ${renderReference(follows.id)} moved before the unit following it landed; the post stands, the row is unchanged`
      );
    }
  }

  /**
   * The transition is re-checked inside the write itself: a row that moved between the read and
   * the post landing is left exactly as it is, and the post stays in the channel as an honest
   * record of what was said (§3.15).
   */
  async commitTransition(prepared: PreparedTransition, postId: string): Promise<void> {
    const moved =
      prepared.to === 'cancelled' || prepared.to === 'done'
        ? await this.closeRecordingClosure(prepared, postId)
        : (
            await this.units.updateMany({
              data: { lastPostId: postId, state: prepared.to },
              where: { id: prepared.unitId, state: { in: statesThatMayReach(prepared.to) } }
            })
          ).count > 0;
    if (!moved) {
      this.loggingService.warn(
        `unit ${renderReference(prepared.unitId)} moved before its transition to ${prepared.to} landed; the post stands, the row is unchanged`
      );
    }
  }

  /** §8.5 — units are control state pointing at posts (§3.15), and the posts they point at are going */
  async eraseBefore(channelId: string, boundary: EpisodeBoundary, transaction: TransactionClient): Promise<void> {
    await transaction.workUnit.deleteMany({ where: { channelId, createdAt: { lt: boundary.eventsAfter } } });
  }

  /** §3.8 — the reference of the unit a post assigned or last moved, which tasks::read shows whole */
  async findReferenceOfPost(postId: string): Promise<string | undefined> {
    const unit = await this.units.findFirst({
      select: { id: true },
      where: { OR: [{ originPostId: postId }, { lastPostId: postId }] }
    });
    return unit === null ? undefined : renderReference(unit.id);
  }

  /**
   * §3.15 — the units a creator's turn owes a verdict: its own units here whose latest report is among
   * the posts the turn answers (§5.2) and still awaits a verdict, oldest first. Keyed on the posts the
   * turn answers, so a report that landed mid-turn and was closed by the next turn is never one.
   */
  findReportsAwaitingVerdict(input: {
    agentUsername: string;
    answeringPostIds: readonly string[];
    channelId: string;
  }): Promise<WorkUnit[]> {
    return this.units.findMany({
      orderBy: { createdAt: 'asc' },
      where: {
        channelId: input.channelId,
        creatorUsername: input.agentUsername,
        lastPostId: { in: [...input.answeringPostIds] },
        state: { in: [...ASSIGNEE_TARGETS] }
      }
    });
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
   * §3.15 — the units a turn of this agent here was working, while they are still assigned: those
   * whose assignment post is among the posts the turn answers (§5.2), oldest first, else, where none
   * of those posts assigned it a unit, the only one it holds assigned in the channel. A unit the turn
   * handed on, by assigning work to a colleague other than that unit's creator, is left out: that
   * colleague's report returns to it. Read from the store, so a running turn and one a restart
   * abandoned are read alike; with several units and none among its posts, it does not guess.
   */
  async findWorkedUnits(input: {
    agentUsername: string;
    answeringPostIds: readonly string[];
    channelId: string;
    turnId: string;
  }): Promise<WorkUnit[]> {
    const held = { assigneeUsername: input.agentUsername, channelId: input.channelId };
    const answered = await this.units.findMany({
      orderBy: { createdAt: 'asc' },
      where: { ...held, originPostId: { in: [...input.answeringPostIds] } }
    });
    const worked =
      answered.length > 0
        ? answered.filter((unit) => unit.state === 'assigned')
        : await this.units.findMany({ take: 2, where: { ...held, state: 'assigned' } });
    const candidates = answered.length > 0 || worked.length === 1 ? worked : [];
    if (candidates.length === 0) {
      return [];
    }
    const handedTo = await this.findAssigneesOfTurn(input.agentUsername, input.channelId, input.turnId);
    return candidates.filter((unit) => ![...handedTo].some((assignee) => assignee !== unit.creatorUsername));
  }

  /** §3.14 — a unit as a plugin tool reads it, found as `read` finds one; an empty reference names none */
  async findWorkUnitView(input: {
    agentUsername: string;
    channelId: string;
    reference: string;
  }): Promise<null | WorkUnitView> {
    if (input.reference === '') {
      return null;
    }
    const found = await this.read(input.agentUsername, input.channelId, input.reference);
    if (!found.success) {
      return null;
    }
    const {
      assigneeUsername,
      closedFrom,
      closedVia,
      context,
      createdAt,
      creatorUsername,
      criteria,
      followsId,
      id,
      outcome,
      state,
      updatedAt
    } = found.value;
    const continuedBy = await this.findSuccessorReference(id);
    return {
      assigneeUsername,
      ...(closedFrom !== null && closedVia !== null && { closure: { from: closedFrom, via: closedVia } }),
      context,
      ...(continuedBy !== undefined && { continuedBy }),
      createdAt,
      creatorUsername,
      criteria,
      ...(followsId !== null && { follows: renderReference(followsId) }),
      outcome,
      reference: renderReference(id),
      state,
      updatedAt
    };
  }

  /** what one turn has read says nothing about another's, so a turn's reads go when it ends (§3.15) */
  forgetPostsReadBy(turnId: string): void {
    this.postSightingsRegistry.forgetTurn(turnId);
  }

  /** open units where the agent is creator or assignee, in this channel, oldest first, each with where its counterpart stands (§3.15) */
  async listOpenFor(input: { agentUsername: string; channelId: string }): Promise<OpenUnitSummary[]> {
    const rows = await this.units.findMany({
      orderBy: { createdAt: 'asc' },
      where: this.openUnitsOf(input.agentUsername, input.channelId)
    });
    return Promise.all(
      rows.filter(isOpenUnit).map(async (row) => ({
        assigneeUsername: row.assigneeUsername,
        counterpart: await this.counterpartStateService.readFor(row, input.agentUsername),
        createdAt: row.createdAt,
        creatorUsername: row.creatorUsername,
        follows: row.followsId === null ? undefined : renderReference(row.followsId),
        outcome: row.outcome,
        reference: renderReference(row.id),
        state: row.state
      }))
    );
  }

  /**
   * Refused, in order: handing to oneself, to a colleague outside the creator's declared set, to a
   * peer absent from the channel (§4.5's inert-text rule cannot be defeated here), to one that
   * could not report back through a unit, a unit to follow that cannot be continued, past the
   * creator's cap, and at either §7.4 limit — refused rather than stripped, since a stripped
   * assignment would announce a hand-off to a peer never activated (§3.15). The unit a
   * continuation closes does not count against the cap.
   */
  async prepareAssign(input: AssignInput): Promise<Result<Addressed<PreparedUnit>, TaskFailure.AssignRefused>> {
    if (input.assigneeUsername === input.actingAgentUsername) {
      return Result.err({ kind: 'self-assignment' });
    }
    if (input.assignees && !input.assignees.includes(input.assigneeUsername)) {
      return Result.err({
        assignees: input.assignees,
        assigneeUsername: input.assigneeUsername,
        kind: 'assignee-undeclared'
      });
    }
    const present = this.rosterService.listAgentsIn(input.channelId);
    if (!present.some((agent) => agent.username === input.assigneeUsername)) {
      return Result.err({ assigneeUsername: input.assigneeUsername, kind: 'assignee-absent' });
    }
    if (!holdsReportTool(this.agentRegistry.get(input.assigneeUsername)?.tools ?? [])) {
      return Result.err({ assigneeUsername: input.assigneeUsername, kind: 'assignee-cannot-report' });
    }
    const followed = input.follows === undefined ? undefined : await this.findContinuable(input, input.follows);
    if (followed && !followed.success) {
      return followed;
    }
    const open = await this.units.count({
      where: { channelId: input.channelId, creatorUsername: input.actingAgentUsername, state: { in: [...OPEN_STATES] } }
    });
    // §3.15 — the unit a continuation closes stops counting against the cap; one closed already never counted
    if (open - (followed?.value.closes ? 1 : 0) >= input.openUnitCap) {
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
      follows: followed?.value ?? null,
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
      prepared: { closedByUsername: input.byUsername, to: 'cancelled', unitId: unit.value.id, via: 'cancellation' },
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
  ): Promise<Result<PreparedClose, TaskFailure.CloseRefused | TaskFailure.Unresolved>> {
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
    const othersOpen = await this.units.count({
      where: { ...this.openUnitsOf(input.actingAgentUsername, input.channelId), id: { not: unit.id } }
    });
    return Result.ok({
      leavesNoneOpen: othersOpen === 0,
      prepared: {
        closedByUsername: input.actingAgentUsername,
        to: input.to,
        unitId: unit.id,
        verdict: input.verdict,
        via: 'close'
      },
      text: renderClosePost(unit, input.to, input.verdict)
    });
  }

  /** §3.15 — the reports the framework makes for a turn that ran out of context, one for each unit it was working */
  async prepareExhaustionReports(input: {
    agentUsername: string;
    answeringPostIds: readonly string[];
    cause: ContextExhaustionCause;
    channelId: string;
    turnId: string;
  }): Promise<Addressed<PreparedTransition>[]> {
    const units = await this.findWorkedUnits(input);
    return units.map((unit) => ({
      addressee: unit.creatorUsername,
      prepared: { to: 'blocked', unitId: unit.id },
      text: renderReportPost(
        unit,
        'blocked',
        `${CONTEXT_EXHAUSTED_REASONS[input.cause]}. ${CONTEXT_EXHAUSTED_FOLLOW_UP}`
      )
    }));
  }

  /** §3.15 — a unit already reported is with its creator, and one closed is past reporting; either refusal names the creator */
  async prepareReport(
    input: TransitionInput & { summary: string; to: (typeof ASSIGNEE_TARGETS)[number] }
  ): Promise<Result<Addressed<PreparedTransition>, TaskFailure.ReportRefused | TaskFailure.Unresolved>> {
    const unit = await this.read(input.actingAgentUsername, input.channelId, input.reference);
    if (!unit.success) {
      return unit;
    }
    const { creatorUsername } = unit.value;
    if (unit.value.assigneeUsername !== input.actingAgentUsername) {
      return Result.err({ assigneeUsername: unit.value.assigneeUsername, kind: 'not-the-assignee' });
    }
    const refused = findTransitionRefusal(unit.value, input.to);
    if (refused?.kind === 'closed') {
      return Result.err({ closed: refused, creatorUsername, kind: 'report-closed' });
    }
    if (refused?.kind === 'illegal-transition' && awaitsVerdictOnReport(refused.from)) {
      const reference = renderReference(unit.value.id);
      return Result.err({ creatorUsername, kind: 'awaiting-verdict', reference, state: refused.from });
    }
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
    const where = { channelId, OR: [{ creatorUsername: agentUsername }, { assigneeUsername: agentUsername }] };
    const matches = await this.units.findMany({ take: 2, where: { ...where, id: { startsWith: reference } } });
    if (matches.length === 1) {
      return Result.ok(matches[0]!);
    }
    if (matches.length > 1) {
      return Result.err({ kind: 'ambiguous', reference });
    }
    const open = await this.units.findMany({
      orderBy: { createdAt: 'asc' },
      select: { id: true },
      where: this.openUnitsOf(agentUsername, channelId)
    });
    return Result.err({ kind: 'not-found', openReferences: open.map(({ id }) => renderReference(id)), reference });
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
      continuedBy: await this.findSuccessorReference(unit.id),
      counterpart: isOpenUnit(unit) ? await this.counterpartStateService.readFor(unit, input.agentUsername) : undefined,
      latestChange: await this.readLatestChange(unit),
      unit
    });
  }

  /**
   * §3.15 — what a close may rest on: the posts a running turn has read, from every window it
   * assembled and every report tasks::read showed it
   */
  recordPostsRead(turnId: string, postIds: Iterable<string>): void {
    this.postSightingsRegistry.recordSeen(turnId, postIds);
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

  /**
   * §3.15 — creates the continuation and closes the unit it follows as done, together or not at all,
   * and only from the state it was read in, which the close records
   */
  private async closeFollowed(
    data: CreatedUnit,
    follows: Extract<FollowedUnit, { closes: true }>,
    postId: string
  ): Promise<boolean> {
    const [, closed] = await this.prismaService.$transaction([
      this.units.create({ data }),
      this.units.updateMany({
        data: {
          closedAt: new Date(),
          closedByUsername: data.creatorUsername,
          closedFrom: follows.from,
          closedVia: 'continuation',
          lastPostId: postId,
          state: 'done',
          verdict: renderContinuationVerdict(data.id, follows.stood)
        },
        where: { id: follows.id, state: follows.from }
      })
    ]);
    return closed.count > 0;
  }

  /**
   * §3.15 — closes the unit from the state this read finds it in, guarded on that state, and records
   * that state and what closed it in the same write
   */
  private closeRecordingClosure(
    prepared: Extract<PreparedTransition, { to: 'cancelled' | 'done' }>,
    postId: string
  ): Promise<boolean> {
    return this.prismaService.$transaction(async (transaction) => {
      const unit = await transaction.workUnit.findUnique({ where: { id: prepared.unitId } });
      if (unit === null || !isOpenUnit(unit) || !statesThatMayReach(prepared.to).includes(unit.state)) {
        return false;
      }
      const closed = await transaction.workUnit.updateMany({
        data: {
          closedAt: new Date(),
          closedByUsername: prepared.closedByUsername,
          closedFrom: unit.state,
          closedVia: prepared.via,
          lastPostId: postId,
          state: prepared.to,
          verdict: prepared.verdict
        },
        where: { id: unit.id, state: unit.state }
      });
      return closed.count > 0;
    });
  }

  /** §3.15 — where a reported unit stands as a continuation closes it: in review, or blocked, and by what */
  private async describeStanding(unit: WorkUnit): Promise<string> {
    if (unit.state !== 'blocked') {
      return 'in review';
    }
    // the framework reports a unit blocked only from a turn that ran out of context (§7.1)
    const reportedBy = await this.conversationsService.findAuthoringTurn(unit.lastPostId);
    return reportedBy?.status === 'context_exhausted' ? 'blocked — context exhausted' : 'blocked';
  }

  /** §3.15 — the colleagues a turn handed units to, read off the assignments it posted */
  private async findAssigneesOfTurn(agentUsername: string, channelId: string, turnId: string): Promise<Set<string>> {
    const spoken = await this.conversationsService.listSpokenBy(turnId);
    if (spoken.length === 0) {
      return new Set();
    }
    const assigned = await this.units.findMany({
      select: { assigneeUsername: true },
      where: { channelId, creatorUsername: agentUsername, originPostId: { in: spoken.map(({ id }) => id) } }
    });
    return new Set(assigned.map(({ assigneeUsername }) => assigneeUsername));
  }

  /**
   * §3.15 — the unit a new one would continue: the acting agent's own, with its report in and read
   * by this turn, since the continuation closes it as done, and handed to the same assignee
   */
  /**
   * §3.15 — the unit a continuation follows: its creator's, to the same assignee, and either in
   * review or blocked with its latest report read, or closed as done and followed by nothing yet
   */
  private async findContinuable(
    input: AssignInput,
    reference: string
  ): Promise<Result<FollowedUnit, TaskFailure.ContinueRefused>> {
    const read = await this.read(input.actingAgentUsername, input.channelId, reference);
    if (!read.success) {
      return read;
    }
    const unit = read.value;
    const resolved = renderReference(unit.id);
    if (unit.creatorUsername !== input.actingAgentUsername) {
      return Result.err({ creatorUsername: unit.creatorUsername, kind: 'not-the-creator' });
    }
    if (unit.state === 'assigned' || unit.state === 'cancelled') {
      return Result.err({ kind: 'not-continuable', reference: resolved, state: unit.state });
    }
    if (unit.assigneeUsername !== input.assigneeUsername) {
      return Result.err({
        assigneeUsername: unit.assigneeUsername,
        kind: 'follows-other-assignee',
        reference: resolved
      });
    }
    if (unit.state === 'done') {
      const successor = await this.units.findFirst({ select: { id: true }, where: { followsId: unit.id } });
      return successor === null
        ? Result.ok({ closes: false, id: unit.id })
        : Result.err({
            kind: 'already-continued',
            reference: resolved,
            successorReference: renderReference(successor.id)
          });
    }
    if (!this.postSightingsRegistry.hasSeen(input.turnId, unit.lastPostId)) {
      return Result.err({ kind: 'report-unread', reference: resolved });
    }
    return Result.ok({ closes: true, from: unit.state, id: unit.id, stood: await this.describeStanding(unit) });
  }

  /** §3.15 — the unit that follows this one, which holds the link; a unit is followed once */
  private async findSuccessorReference(unitId: string): Promise<string | undefined> {
    const successor = await this.units.findFirst({ select: { id: true }, where: { followsId: unitId } });
    return successor === null ? undefined : renderReference(successor.id);
  }

  /**
   * §3.15 — links a unit closed as done earlier, keeping its creator's verdict and naming its
   * successor there. The verdict is written only as it was read, so of two links racing for one
   * unit exactly one lands, and the other writes nothing: not the link, and not its successor.
   */
  private linkFollowed(data: CreatedUnit, follows: FollowedUnit): Promise<boolean> {
    return this.prismaService.$transaction(async (transaction) => {
      const followed = await transaction.workUnit.findUnique({ where: { id: follows.id } });
      const taken = await transaction.workUnit.count({ where: { followsId: follows.id } });
      if (followed?.state !== 'done' || taken > 0) {
        return false;
      }
      const linked = await transaction.workUnit.updateMany({
        data: { verdict: renderContinuationVerdict(data.id, followed.verdict) },
        where: { id: follows.id, state: 'done', verdict: followed.verdict }
      });
      if (linked.count === 0) {
        return false;
      }
      await transaction.workUnit.create({ data });
      return true;
    });
  }

  /** the open units the agent is a party to in the channel, as creator or assignee (§3.15) */
  private openUnitsOf(agentUsername: string, channelId: string) {
    return {
      channelId,
      OR: [{ creatorUsername: agentUsername }, { assigneeUsername: agentUsername }],
      state: { in: [...OPEN_STATES] }
    };
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
