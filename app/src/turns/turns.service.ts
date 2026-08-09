import { Injectable } from '@nestjs/common';

import type { TokenUsage } from '@/inference/inference.types.ts';
import { InjectModel } from '@/prisma/prisma.decorators.ts';
import type { Model, ModelRow, TurnStatus } from '@/prisma/prisma.types.ts';
import { isUniqueConstraintViolation } from '@/prisma/prisma.utils.ts';

import type { Turn, TurnEventInput } from './turns.types.ts';

@Injectable()
export class TurnsService {
  constructor(
    @InjectModel('TurnEvent') private readonly events: Model<'TurnEvent'>,
    @InjectModel('Turn') private readonly turns: Model<'Turn'>
  ) {}

  /** §7.3 — nothing resumes; every turn left running by a crash is closed as abandoned */
  async abandonRunning(): Promise<number> {
    const { count } = await this.turns.updateMany({
      data: { endedAt: new Date(), status: 'abandoned' },
      where: { status: 'running' }
    });
    return count;
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
    summary: { actionCount?: number; usage?: TokenUsage } = {}
  ): Promise<void> {
    await this.turns.update({
      data: {
        endedAt: new Date(),
        status,
        ...(summary.actionCount !== undefined && { actionCount: summary.actionCount }),
        ...(summary.usage && {
          completionTokens: summary.usage.completionTokens,
          promptTokens: summary.usage.promptTokens
        })
      },
      where: { id: turnId }
    });
  }

  /** the full §8.3 trace, in the order it happened */
  listEvents(turnId: string): Promise<ModelRow<'TurnEvent'>[]> {
    return this.events.findMany({ orderBy: { sequence: 'asc' }, where: { turnId } });
  }

  open(input: {
    agentUsername: string;
    channelId: string;
    depth: number;
    modelName: string;
    triggeringPostId?: string;
  }): Promise<Turn> {
    return this.turns.create({
      data: {
        agentUsername: input.agentUsername,
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
}
