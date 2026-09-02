import type { $MemorySettings } from '@collegium/core/toolsets';
import { Result } from '@collegium/core/utils';
import { Injectable } from '@nestjs/common';

import { InjectModel } from '@/prisma/prisma.decorators.ts';
import type { Model, ModelRow } from '@/prisma/prisma.types.ts';

import { MemoryLockService } from './locks/memory-lock.service.ts';
import { renderMemoryReference } from './memory.utils.ts';

import type { MemoryFailure, MemoryListing, MemoryWrite, MemoryWriteReceipt } from './memory.types.ts';

@Injectable()
export class MemoryService {
  constructor(
    private readonly locks: MemoryLockService,
    @InjectModel('Memory') private readonly memories: Model<'Memory'>
  ) {}

  async delete(agentUsername: string, reference: string): Promise<Result<void, MemoryFailure.Unresolved>> {
    const memory = await this.read(agentUsername, reference);
    if (!memory.success) {
      return Result.err(memory.error);
    }
    await this.memories.deleteMany({ where: { id: memory.value.id } });
    return Result.ok();
  }

  /** oldest first; loaded into the system prompt on every turn, which is why bodies are not selected (§3.6) */
  async list(agentUsername: string): Promise<MemoryListing[]> {
    const entries = await this.memories.findMany({
      orderBy: { createdAt: 'asc' },
      select: { description: true, id: true },
      where: { agentUsername }
    });
    return entries.map(({ description, id }) => ({ description, reference: renderMemoryReference(id) }));
  }

  /** loaded on demand, by reference or full id. Scoped by agent, so another agent's entry is simply absent (§3.6) */
  async read(agentUsername: string, reference: string): Promise<Result<ModelRow<'Memory'>, MemoryFailure.Unresolved>> {
    const matches = await this.memories.findMany({ take: 2, where: { agentUsername, id: { startsWith: reference } } });
    if (matches.length === 0) {
      return Result.err({ kind: 'not-found', reference });
    }
    if (matches.length > 1) {
      return Result.err({ kind: 'ambiguous', reference });
    }
    return Result.ok(matches[0]!);
  }

  /** ungated, the single exception to A5 (§3.6). Takes the per-agent lock, since the cap is a read-modify-write */
  async write(
    input: MemoryWrite,
    caps: $MemorySettings
  ): Promise<Result<MemoryWriteReceipt<ModelRow<'Memory'>>, MemoryFailure.TooLong>> {
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
      const entry = await this.memories.create({ data: input });
      return Result.ok({ entry, evictedDescriptions, reference: renderMemoryReference(entry.id) });
    });
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
