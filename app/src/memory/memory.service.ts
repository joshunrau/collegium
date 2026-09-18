import type { $MemorySettings } from '@collegium/core/toolsets';
import { Result } from '@collegium/core/utils';
import { Injectable } from '@nestjs/common';

import { InjectModel } from '@/prisma/prisma.decorators.ts';
import { PrismaService } from '@/prisma/prisma.service.ts';
import type { Model, ModelRow } from '@/prisma/prisma.types.ts';

import { MemoryLockService } from './locks/memory-lock.service.ts';
import { renderMemoryReference } from './memory.utils.ts';

import type {
  MemoryFailure,
  MemoryListing,
  MemoryRevision,
  MemoryRevisionReceipt,
  MemoryWrite,
  MemoryWriteReceipt
} from './memory.types.ts';

@Injectable()
export class MemoryService {
  constructor(
    private readonly locks: MemoryLockService,
    @InjectModel('Memory') private readonly memories: Model<'Memory'>,
    private readonly prismaService: PrismaService
  ) {}

  /**
   * Ungated like a write (§3.6), and disclosed the same way. Takes the per-agent lock so a delete
   * cannot land inside a concurrent write's count-then-evict and cost that write an extra entry.
   */
  async delete(
    agentUsername: string,
    reference: string
  ): Promise<Result<ModelRow<'Memory'>, MemoryFailure.Unresolved>> {
    return this.locks.run(agentUsername, async () => {
      const memory = await this.read(agentUsername, reference);
      if (!memory.success) {
        return Result.err(memory.error);
      }
      await this.memories.deleteMany({ where: { id: memory.value.id } });
      return Result.ok(memory.value);
    });
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

  /**
   * §3.6 — records that a body was needed, which is what eviction orders by. Separate from `read`,
   * so the callers that mean "this mattered" say so. Takes no lock: it cannot change the entry
   * count, and `updateMany` makes a touch racing an eviction of the same row a no-op.
   */
  async markUsed(id: string): Promise<void> {
    await this.memories.updateMany({ data: { lastUsedAt: new Date() }, where: { id } });
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

  /**
   * §3.6 — one step: the stored body is read and revised under the per-agent lock, and the revision
   * written as a new entry in the same transaction that deletes the old one. The entry count does
   * not change, so nothing is evicted.
   */
  async revise<TRefusal>(
    revision: MemoryRevision,
    reviseBody: (body: string) => Result<string, TRefusal>,
    caps: $MemorySettings
  ): Promise<
    Result<
      MemoryRevisionReceipt<ModelRow<'Memory'>>,
      MemoryFailure.EmptyBody | MemoryFailure.TooLong | MemoryFailure.Unresolved | TRefusal
    >
  > {
    return this.locks.run(revision.agentUsername, async () => {
      const current = await this.read(revision.agentUsername, revision.reference);
      if (!current.success) {
        return Result.err(current.error);
      }
      const body = reviseBody(current.value.body);
      if (!body.success) {
        return Result.err(body.error);
      }
      if (body.value.trim() === '') {
        return Result.err({ kind: 'empty-body' });
      }
      if (body.value.length > caps.maxBodyChars) {
        return Result.err({ field: 'body', kind: 'too-long', length: body.value.length, limit: caps.maxBodyChars });
      }
      const entry = await this.prismaService.$transaction(async (transaction) => {
        const revised = await transaction.memory.create({
          data: {
            agentUsername: revision.agentUsername,
            body: body.value,
            description: current.value.description,
            originPostId: revision.originPostId
          }
        });
        await transaction.memory.deleteMany({ where: { id: current.value.id } });
        return revised;
      });
      return Result.ok({
        entry,
        reference: renderMemoryReference(entry.id),
        revisionOf: renderMemoryReference(current.value.id)
      });
    });
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

  /** §3.6 — leaves room for one more entry by dropping the least recently used, so a write at the cap never fails */
  private async evictBeyond(agentUsername: string, maxEntries: number): Promise<string[]> {
    const surplus = (await this.memories.count({ where: { agentUsername } })) - maxEntries + 1;
    if (surplus <= 0) {
      return [];
    }
    const stalest = await this.memories.findMany({
      orderBy: { lastUsedAt: 'asc' },
      select: { description: true, id: true },
      take: surplus,
      where: { agentUsername }
    });
    await this.memories.deleteMany({ where: { id: { in: stalest.map(({ id }) => id) } } });
    return stalest.map(({ description }) => description);
  }
}
