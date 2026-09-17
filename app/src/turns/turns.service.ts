import { Injectable } from '@nestjs/common';

import type { CompletionUsage } from '@/inference/inference.types.ts';
import { InjectModel } from '@/prisma/prisma.decorators.ts';
import type { Model, ModelRow, TurnStatus } from '@/prisma/prisma.types.ts';
import { isUniqueConstraintViolation } from '@/prisma/prisma.utils.ts';

import { sumUsageTotals, toReportedTotal } from './turns.utils.ts';

import type { AbandonedTurns, Turn, TurnEventInput, UsageReport } from './turns.types.ts';

@Injectable()
export class TurnsService {
  constructor(
    @InjectModel('TurnEvent') private readonly events: Model<'TurnEvent'>,
    @InjectModel('Turn') private readonly turns: Model<'Turn'>
  ) {}

  /**
   * §7.3 — nothing resumes; every turn left running by a crash is closed as abandoned. The status
   * posts are read before the update, since afterwards nothing names which turns this boot closed.
   */
  async abandonRunning(): Promise<AbandonedTurns> {
    const running = await this.turns.findMany({
      orderBy: { startedAt: 'desc' },
      select: { agentUsername: true, channelId: true, statusPostId: true },
      where: { status: 'running' }
    });
    await this.turns.updateMany({ data: { endedAt: new Date(), status: 'abandoned' }, where: { status: 'running' } });
    const statusPosts = running.flatMap((turn) => {
      if (turn.statusPostId === null) {
        return [];
      }
      return [{ agentUsername: turn.agentUsername, channelId: turn.channelId, postId: turn.statusPostId }];
    });
    return { count: running.length, statusPosts };
  }

  /**
   * Every tool call, result, approval request and decision, and memory write, in order (§8.3).
   * This is the only writer of `TurnEvent`, and it derives the `kind` column from the payload so
   * the two can never disagree. The sequence is gapless per turn; the unique constraint turns a
   * concurrent append into a retry rather than a gap.
   */
  async appendEvent(turnId: string, event: TurnEventInput): Promise<void> {
    for (;;) {
      const last = await this.events.findFirst({
        orderBy: { sequence: 'desc' },
        select: { sequence: true },
        where: { turnId }
      });
      try {
        await this.events.create({
          data: { kind: event.kind, payload: event, sequence: (last?.sequence ?? -1) + 1, turnId }
        });
        return;
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
        ...(summary.usage && {
          cachedPromptTokens: summary.usage.cachedPromptTokens ?? null,
          completionTokens: summary.usage.completionTokens,
          costUsd: summary.usage.costUsd ?? null,
          promptTokens: summary.usage.promptTokens,
          reasoningTokens: summary.usage.reasoningTokens ?? null
        })
      },
      where: { id: turnId }
    });
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

  /** the full §8.3 trace, in the order it happened */
  listEvents(turnId: string): Promise<ModelRow<'TurnEvent'>[]> {
    return this.events.findMany({ orderBy: { sequence: 'asc' }, where: { turnId } });
  }

  open(input: {
    agentUsername: string;
    chainLength: number;
    channelId: string;
    depth: number;
    modelName: string;
    triggeringPostId?: string;
  }): Promise<Turn> {
    return this.turns.create({
      data: {
        agentUsername: input.agentUsername,
        chainLength: input.chainLength,
        channelId: input.channelId,
        depth: input.depth,
        modelName: input.modelName,
        status: 'running',
        triggeringPostId: input.triggeringPostId
      }
    });
  }

  async recordStatusPost(turnId: string, statusPostId: string): Promise<void> {
    await this.turns.update({ data: { statusPostId }, where: { id: turnId } });
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
