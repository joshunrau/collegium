import { Result } from '@collegium/core/utils';
import { Injectable } from '@nestjs/common';

import { AgentRegistry } from '@/agents/agents.registry.ts';
import type { $MemoryCaps } from '@/config/config.schemas.ts';
import { InjectModel } from '@/prisma/prisma.decorators.ts';
import type { Model, ModelRow } from '@/prisma/prisma.types.ts';

import { MemoryLockService } from './locks/memory-lock.service.ts';

import type { MemoryFailure, MemoryWrite, MemoryWriteReceipt } from './memory.types.ts';

@Injectable()
export class MemoryService {
  constructor(
    private readonly agentRegistry: AgentRegistry,
    private readonly locks: MemoryLockService,
    @InjectModel('Memory') private readonly memories: Model<'Memory'>
  ) {}

  async delete(agentUsername: string, id: string): Promise<Result<void, MemoryFailure.NotFound>> {
    const { count } = await this.memories.deleteMany({ where: { agentUsername, id } });
    if (count === 0) {
      return Result.err({ id, kind: 'not-found' });
    }
    return Result.ok();
  }

  /** everything the agent remembers, oldest first — what /memory shows a human (§8.4) */
  list(agentUsername: string): Promise<ModelRow<'Memory'>[]> {
    return this.memories.findMany({ orderBy: { createdAt: 'asc' }, where: { agentUsername } });
  }

  /** loaded into the system prompt on every turn, which is why bodies are not selected (§3.6) */
  listDescriptions(agentUsername: string): Promise<{ description: string; id: string }[]> {
    return this.memories.findMany({
      orderBy: { createdAt: 'asc' },
      select: { description: true, id: true },
      where: { agentUsername }
    });
  }

  /** loaded on demand. Scoped by agent, so another agent's id is simply absent (§3.6) */
  async read(agentUsername: string, id: string): Promise<Result<ModelRow<'Memory'>, MemoryFailure.NotFound>> {
    const memory = await this.memories.findFirst({ where: { agentUsername, id } });
    if (!memory) {
      return Result.err({ id, kind: 'not-found' });
    }
    return Result.ok(memory);
  }

  /** ungated, the single exception to A5 (§3.6). Takes the per-agent lock, since the cap is a read-modify-write */
  async write(input: MemoryWrite): Promise<Result<MemoryWriteReceipt<ModelRow<'Memory'>>, MemoryFailure.TooLong>> {
    const caps = this.capsFor(input.agentUsername);
    if (input.description.length > caps.maxDescriptionChars) {
      return Result.err({
        field: 'description',
        kind: 'too-long',
        length: input.description.length,
        limit: caps.maxDescriptionChars
      });
    }
    if (input.body.length > caps.maxBodyChars) {
      return Result.err({ field: 'body', kind: 'too-long', length: input.body.length, limit: caps.maxBodyChars });
    }
    return this.locks.run(input.agentUsername, async () => {
      const evictedDescriptions = await this.evictBeyond(input.agentUsername, caps.maxEntries);
      return Result.ok({ entry: await this.memories.create({ data: input }), evictedDescriptions });
    });
  }

  private capsFor(agentUsername: string): $MemoryCaps {
    const profile = this.agentRegistry.get(agentUsername);
    if (!profile) {
      throw new Error(`no agent is registered as "${agentUsername}"`);
    }
    return profile.memoryCaps;
  }

  /** leaves room for one more entry by dropping the oldest, so a write at the cap never fails */
  private async evictBeyond(agentUsername: string, maxEntries: number): Promise<string[]> {
    const surplus = (await this.memories.count({ where: { agentUsername } })) - maxEntries + 1;
    if (surplus <= 0) {
      return [];
    }
    const oldest = await this.memories.findMany({
      orderBy: { createdAt: 'asc' },
      select: { description: true, id: true },
      take: surplus,
      where: { agentUsername }
    });
    await this.memories.deleteMany({ where: { id: { in: oldest.map(({ id }) => id) } } });
    return oldest.map(({ description }) => description);
  }
}
