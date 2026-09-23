import { Injectable } from '@nestjs/common';

import { ApprovalsService } from '@/approvals/approvals.service.ts';
import { AsksService } from '@/approvals/asks.service.ts';
import { ConversationsService } from '@/conversations/conversations.service.ts';
import type { EpisodeBoundary, RecordablePost } from '@/conversations/conversations.types.ts';
import { EpisodesService } from '@/conversations/episodes/episodes.service.ts';
import { MemoryService } from '@/memory/memory.service.ts';
import { PrismaService } from '@/prisma/prisma.service.ts';
import type { TransactionClient } from '@/prisma/prisma.types.ts';
import { QueueService } from '@/queue/queue.service.ts';
import { TasksService } from '@/tasks/tasks.service.ts';
import { TriggersService } from '@/triggers/triggers.service.ts';
import { TurnsService } from '@/turns/turns.service.ts';

import type { MemoryTally } from '../clearing.types.ts';

/** a large channel outlives the interactive default of five seconds */
const TRANSACTION_TIMEOUT_MS = 60_000;

export type ErasureInput = {
  readonly boundary: EpisodeBoundary;
  readonly channelId: string;
  /** the boundary post, recorded first so a restart backfills from it (§8.2) */
  readonly notice: RecordablePost;
  /** whether to name the memories written from turns here, before the pointers they hang on are nulled */
  readonly selectMemories: boolean;
};

/**
 * §8.5 — one transaction, each module cutting its own tables against the boundary. A crash between
 * two of these steps would leave a turn able to read half a channel, events without their posts,
 * until the human ran the command again.
 */
@Injectable()
export class ChannelErasure {
  constructor(
    private readonly approvalsService: ApprovalsService,
    private readonly asksService: AsksService,
    private readonly conversationsService: ConversationsService,
    private readonly episodesService: EpisodesService,
    private readonly memoryService: MemoryService,
    private readonly prismaService: PrismaService,
    private readonly queueService: QueueService,
    private readonly tasksService: TasksService,
    private readonly triggersService: TriggersService,
    private readonly turnsService: TurnsService
  ) {}

  erase(input: ErasureInput): Promise<readonly MemoryTally[]> {
    const { boundary, channelId } = input;
    return this.prismaService.$transaction(
      async (transaction) => {
        await this.conversationsService.record(input.notice, undefined, transaction);
        const tally = input.selectMemories ? await this.selectMemories(channelId, transaction) : [];
        await this.conversationsService.eraseBefore(channelId, boundary, transaction);
        await this.episodesService.eraseBefore(channelId, boundary, transaction);
        await this.episodesService.recordClear(channelId, boundary, transaction);
        await this.turnsService.eraseContentBefore(channelId, boundary, transaction);
        await this.approvalsService.eraseBefore(channelId, boundary, transaction);
        await this.asksService.eraseBefore(channelId, boundary, transaction);
        await this.queueService.eraseBefore(channelId, boundary, input.notice.id, transaction);
        await this.tasksService.eraseBefore(channelId, boundary, transaction);
        await this.triggersService.eraseDeliveredBefore(channelId, boundary, transaction);
        return tally;
      },
      { timeout: TRANSACTION_TIMEOUT_MS }
    );
  }

  private async selectMemories(channelId: string, transaction: TransactionClient): Promise<MemoryTally[]> {
    const origins = await this.turnsService.listTriggeringPostIdsIn(channelId, transaction);
    const entries = await this.memoryService.listOriginatingFrom(origins, transaction);
    const byAgent = new Map<string, string[]>();
    for (const { agentUsername, id } of entries) {
      byAgent.set(agentUsername, [...(byAgent.get(agentUsername) ?? []), id]);
    }
    return [...byAgent].map(([agentUsername, memoryIds]) => ({ agentUsername, memoryIds }));
  }
}
