import { Result } from '@collegium/core/utils';
import { Injectable } from '@nestjs/common';

import { ConfigService } from '@/config/config.service.ts';
import type { EpisodeBoundary } from '@/conversations/conversations.types.ts';
import type { CompletionUsage } from '@/inference/inference.types.ts';
import { InjectModel } from '@/prisma/prisma.decorators.ts';
import { PrismaService } from '@/prisma/prisma.service.ts';
import type {
  ActivationKind,
  Model,
  ModelRow,
  ResultPresentation,
  TransactionClient,
  TurnStatus
} from '@/prisma/prisma.types.ts';
import { isUniqueConstraintViolation } from '@/prisma/prisma.utils.ts';

import { sumUsageTotals, toReportedTotal, toUsageColumns } from './turns.utils.ts';

import type {
  AbandonedTurns,
  AssembledWindowRecord,
  EstimatedSpend,
  Turn,
  TurnEventInput,
  TurnOpenFailure,
  UsageReport
} from './turns.types.ts';

@Injectable()
export class TurnsService {
  private readonly chainLengthLimit: number;

  constructor(
    configService: ConfigService,
    @InjectModel('TurnEvent') private readonly events: Model<'TurnEvent'>,
    private readonly prismaService: PrismaService,
    @InjectModel('Turn') private readonly turns: Model<'Turn'>
  ) {
    this.chainLengthLimit = configService.get('turns.chainLengthLimit');
  }

  /**
   * §7.3 — nothing resumes; every turn left running by a crash is closed as abandoned. The status
   * posts are read before the update, since afterwards nothing names which turns this boot closed.
   *
   * A turn had not acted when it recorded no `assistant_message`: that event is written before any
   * call in its completion is admitted, and before a final reply is posted. Neither the status post,
   * which is best-effort, nor a `tool_result`, which a call parked on approval has not written yet,
   * proves that nothing ran.
   */
  async abandonRunning(): Promise<AbandonedTurns> {
    const running = await this.turns.findMany({
      orderBy: { startedAt: 'desc' },
      select: {
        _count: { select: { events: { where: { kind: 'assistant_message' } } } },
        agentUsername: true,
        channelId: true,
        id: true,
        statusPostId: true,
        triggeringPostId: true
      },
      where: { status: 'running' }
    });
    await this.turns.updateMany({ data: { endedAt: new Date(), status: 'abandoned' }, where: { status: 'running' } });
    const statusPosts = running.flatMap((turn) => {
      if (turn.statusPostId === null) {
        return [];
      }
      return [{ agentUsername: turn.agentUsername, channelId: turn.channelId, postId: turn.statusPostId }];
    });
    const acted = running.flatMap((turn) => {
      if (turn._count.events === 0) {
        return [];
      }
      return [
        {
          agentUsername: turn.agentUsername,
          channelId: turn.channelId,
          triggeringPostId: turn.triggeringPostId ?? undefined
        }
      ];
    });
    const unacted = running.flatMap((turn) => {
      if (turn._count.events > 0 || turn.triggeringPostId === null) {
        return [];
      }
      return [
        { agentUsername: turn.agentUsername, channelId: turn.channelId, triggeringPostId: turn.triggeringPostId }
      ];
    });
    const turns = running.map((turn) => ({
      agentUsername: turn.agentUsername,
      channelId: turn.channelId,
      turnId: turn.id
    }));
    return { acted, statusPosts, turns, unacted };
  }

  /**
   * Every tool call, result, approval request and decision, and memory write, in order (§8.3).
   * This is the only writer of `TurnEvent`, and it derives the `kind` column from the payload so
   * the two can never disagree. The sequence is gapless per turn; the unique constraint turns a
   * concurrent append into a retry rather than a gap. Returns the event's id.
   */
  /** §3.8 — the event's sequence is its result's reference within the turn, so the caller gets it with the id */
  async appendEvent(
    turnId: string,
    event: TurnEventInput
  ): Promise<{ readonly id: string; readonly sequence: number }> {
    for (;;) {
      const last = await this.events.findFirst({
        orderBy: { sequence: 'desc' },
        select: { sequence: true },
        where: { turnId }
      });
      try {
        return await this.events.create({
          data: { kind: event.kind, payload: event, sequence: (last?.sequence ?? -1) + 1, turnId },
          select: { id: true, sequence: true }
        });
      } catch (error) {
        if (!isUniqueConstraintViolation(error)) {
          throw error;
        }
      }
    }
  }

  async close(
    turnId: string,
    status: Exclude<TurnStatus, 'running'>,
    summary: { actionCount?: number; usage?: CompletionUsage } = {}
  ): Promise<void> {
    await this.turns.update({
      data: {
        endedAt: new Date(),
        status,
        ...(summary.actionCount !== undefined && { actionCount: summary.actionCount }),
        ...(summary.usage && toUsageColumns(summary.usage))
      },
      where: { id: turnId }
    });
  }

  /** §7.4 — how many turns one human or trigger post has set in motion, the running one included */
  countInChain(rootPostId: string): Promise<number> {
    return this.turns.count({ where: { rootPostId } });
  }

  /**
   * §7.4 — how many turns have started strictly after a given moment, framework-wide. The rolling
   * window is counted here rather than held in memory: a crash-looping instance must not grant
   * itself a fresh allowance every boot, which would make the framework-wide number untrue. Strictly
   * after, because both moments it is asked about — the hour boundary and the `/resume` watermark —
   * are already past when they are handed over.
   */
  countStartedAfter(moment: Date): Promise<number> {
    return this.turns.count({ where: { startedAt: { gt: moment } } });
  }

  /** §8.5 — the turn record stays as accounting; its content and every pointer to a post go */
  async eraseContentBefore(
    channelId: string,
    boundary: EpisodeBoundary,
    transaction: TransactionClient
  ): Promise<void> {
    const turn = { channelId, startedAt: { lt: boundary.eventsAfter } };
    await transaction.turnEvent.deleteMany({ where: { turn } });
    await transaction.turn.updateMany({
      data: { drainedFromPostId: null, rootPostId: null, statusPostId: null, triggeringPostId: null },
      where: turn
    });
  }

  /** when the agent's most recent turn in the channel started, whatever became of it; undefined where it has had none */
  async findLatestStartIn(agentUsername: string, channelId: string): Promise<Date | undefined> {
    const latest = await this.turns.findFirst({
      orderBy: { startedAt: 'desc' },
      select: { startedAt: true },
      where: { agentUsername, channelId }
    });
    return latest?.startedAt;
  }

  /** the agent's open turn in the channel, which §5.1 makes at most one: the post that started it, and its status post once it has one */
  async findRunningIn(
    agentUsername: string,
    channelId: string
  ): Promise<Pick<Turn, 'id' | 'statusPostId' | 'triggeringPostId'> | undefined> {
    const running = await this.turns.findFirst({
      select: { id: true, statusPostId: true, triggeringPostId: true },
      where: { agentUsername, channelId, status: 'running' }
    });
    return running ?? undefined;
  }

  /** the full §8.3 trace, in the order it happened */
  listEvents(turnId: string): Promise<ModelRow<'TurnEvent'>[]> {
    return this.events.findMany({ orderBy: { sequence: 'asc' }, where: { turnId } });
  }

  /** §8.5 — the provenance a memory written from this channel carries (§3.6), read before a clear nulls it */
  async listTriggeringPostIdsIn(channelId: string, transaction: TransactionClient): Promise<string[]> {
    const turns = await transaction.turn.findMany({
      distinct: ['triggeringPostId'],
      select: { triggeringPostId: true },
      where: { channelId, triggeringPostId: { not: null } }
    });
    return turns.flatMap(({ triggeringPostId }) => triggeringPostId ?? []);
  }

  /**
   * §7.4 — admission is the guarantee: the chain is counted and the row inserted in one transaction,
   * so two turns of one chain racing to open at the limit open exactly one. The output-time refusal
   * is the friendly stop that fires first in the common case; this is what makes "at most the
   * limit" true rather than hoped for.
   */
  open(input: {
    activationKind: ActivationKind;
    agentUsername: string;
    chainLength: number;
    channelId: string;
    depth: number;
    drainedFromPostId?: string;
    modelName: string;
    rootPostId: string;
    triggeringPostId?: string;
  }): Promise<Result<Turn, TurnOpenFailure.ChainFull>> {
    return this.prismaService.$transaction(async (transaction) => {
      const count = await transaction.turn.count({ where: { rootPostId: input.rootPostId } });
      if (count >= this.chainLengthLimit) {
        return Result.err({ count, kind: 'chain-full', limit: this.chainLengthLimit, rootPostId: input.rootPostId });
      }
      const turn = await transaction.turn.create({
        data: {
          activationKind: input.activationKind,
          agentUsername: input.agentUsername,
          chainLength: input.chainLength,
          channelId: input.channelId,
          depth: input.depth,
          drainedFromPostId: input.drainedFromPostId,
          modelName: input.modelName,
          rootPostId: input.rootPostId,
          status: 'running',
          triggeringPostId: input.triggeringPostId
        }
      });
      return Result.ok(turn);
    });
  }

  /** §8.3 — the window the turn's context was last assembled from; a fold (§4.4) overwrites it */
  async recordAssembledWindow(turnId: string, window: AssembledWindowRecord): Promise<void> {
    await this.turns.update({
      data: {
        contextAssembledAt: window.assembledAt,
        windowEstimatedTokens: window.estimatedTokens,
        windowOldestAt: window.oldestAt ?? null
      },
      where: { id: turnId }
    });
  }

  /**
   * §3.8 — how the model came to read a result it did not read whole, merged into what the event
   * already records: a cut result can later collapse. The output itself is never rewritten.
   */
  async recordPresentation(eventId: string, presentation: ResultPresentation): Promise<void> {
    const { payload } = await this.events.findUniqueOrThrow({ select: { payload: true }, where: { id: eventId } });
    if (payload.kind !== 'tool_result') {
      throw new Error(`event ${eventId} records a ${payload.kind}, which has no presentation`);
    }
    await this.events.update({
      data: { payload: { ...payload, presentedAs: { ...payload.presentedAs, ...presentation } } },
      where: { id: eventId }
    });
  }

  async recordStatusPost(turnId: string, statusPostId: string): Promise<void> {
    await this.turns.update({ data: { statusPostId }, where: { id: turnId } });
  }

  /** §8.2 — the turn's running totals, written after each completion as absolutes, so a turn a restart abandons keeps what it paid for */
  async recordUsage(turnId: string, usage: CompletionUsage): Promise<void> {
    await this.turns.update({ data: toUsageColumns(usage), where: { id: turnId } });
  }

  /**
   * §8.2 — the completions cut at their time limit or by a steer strictly after a moment, which the
   * provider reported nothing of: how many, and the tokens their events estimate. Never in a total.
   */
  async summarizeEstimatesAfter(moment: Date): Promise<EstimatedSpend> {
    const events = await this.events.findMany({
      select: { payload: true },
      where: { createdAt: { gt: moment }, kind: { in: ['output_rejected', 'steering_received'] } }
    });
    const estimates = events.flatMap(({ payload }) => {
      const usage =
        payload.kind === 'output_rejected' || payload.kind === 'steering_received' ? payload.usage : undefined;
      return usage !== undefined && 'estimated' in usage ? [usage.completionTokens + usage.reasoningTokens] : [];
    });
    return { completions: estimates.length, tokens: estimates.reduce((sum, tokens) => sum + tokens, 0) };
  }

  /** framework-wide spend per agent and model, over turns that ended strictly after a moment with usage recorded */
  async summarizeUsageEndedAfter(moment: Date): Promise<UsageReport> {
    const groups = await this.turns.groupBy({
      _count: { _all: true, cachedPromptTokens: true, costUsd: true, reasoningTokens: true },
      _sum: {
        cachedPromptTokens: true,
        completionTokens: true,
        costUsd: true,
        promptTokens: true,
        reasoningTokens: true
      },
      by: ['agentUsername', 'modelName'],
      orderBy: [{ agentUsername: 'asc' }, { modelName: 'asc' }],
      where: { endedAt: { gt: moment }, promptTokens: { not: null } }
    });
    const rows = groups.map((group) => ({
      agentUsername: group.agentUsername,
      cachedPromptTokens: toReportedTotal(
        group._sum.cachedPromptTokens,
        group._count.cachedPromptTokens,
        group._count._all
      ),
      completionTokens: group._sum.completionTokens ?? 0,
      costUsd: toReportedTotal(group._sum.costUsd, group._count.costUsd, group._count._all),
      modelName: group.modelName,
      promptTokens: group._sum.promptTokens ?? 0,
      reasoningTokens: toReportedTotal(group._sum.reasoningTokens, group._count.reasoningTokens, group._count._all),
      turnCount: group._count._all
    }));
    return { rows, total: sumUsageTotals(rows) };
  }
}
