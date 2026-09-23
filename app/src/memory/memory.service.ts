import type { $MemorySettings } from '@collegium/core/toolsets';
import { Result } from '@collegium/core/utils';
import { Injectable } from '@nestjs/common';

import { InjectModel } from '@/prisma/prisma.decorators.ts';
import type { Model, ModelRow, TransactionClient } from '@/prisma/prisma.types.ts';

import { MemoryLockService } from './locks/memory-lock.service.ts';
import { renderMemoryReference } from './memory.utils.ts';

import type {
  MemoryFailure,
  MemoryListing,
  MemoryListingWithRevisions,
  MemoryRevision,
  MemoryRevisionReceipt,
  MemoryWrite,
  MemoryWriteReceipt
} from './memory.types.ts';

/** how many origin post ids one `in` carries — well inside SQLite's bound on variables in a statement */
const ORIGIN_CHUNK_SIZE = 500;

@Injectable()
export class MemoryService {
  constructor(
    private readonly locks: MemoryLockService,
    @InjectModel('Memory') private readonly memories: Model<'Memory'>
  ) {}

  /** §8.4 — an operator's prune, which removes whatever revision is stored */
  delete(agentUsername: string, reference: string): Promise<Result<ModelRow<'Memory'>, MemoryFailure.Unresolved>> {
    return this.deleteAdmitted(agentUsername, reference, () => Result.ok());
  }

  /**
   * Ungated like a write (§3.6), and disclosed the same way. Takes the per-agent lock so a delete
   * cannot land inside a concurrent write's count-then-evict and cost that write an extra entry,
   * and so the revision `admit` judges is the one deleted.
   */
  async deleteAdmitted<TRefusal>(
    agentUsername: string,
    reference: string,
    admit: (entry: ModelRow<'Memory'>) => Result<void, TRefusal>
  ): Promise<Result<ModelRow<'Memory'>, MemoryFailure.Unresolved | TRefusal>> {
    return this.locks.run(agentUsername, async () => {
      const memory = await this.read(agentUsername, reference);
      if (!memory.success) {
        return Result.err(memory.error);
      }
      const admitted = admit(memory.value);
      if (!admitted.success) {
        return Result.err(admitted.error);
      }
      await this.memories.deleteMany({ where: { id: memory.value.id } });
      return Result.ok(memory.value);
    });
  }

  /** §8.5 — the named entries, under the per-agent lock as any delete is; returns how many were still there */
  deleteMany(agentUsername: string, ids: readonly string[]): Promise<number> {
    return this.locks.run(agentUsername, async () => {
      const { count } = await this.memories.deleteMany({ where: { agentUsername, id: { in: [...ids] } } });
      return count;
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

  /** §8.5 — every entry whose provenance (§3.6) is one of the named posts, whichever agent holds it */
  async listOriginatingFrom(
    originPostIds: readonly string[],
    transaction: TransactionClient
  ): Promise<{ agentUsername: string; id: string }[]> {
    const found: { agentUsername: string; id: string }[] = [];
    for (let start = 0; start < originPostIds.length; start += ORIGIN_CHUNK_SIZE) {
      const chunk = originPostIds.slice(start, start + ORIGIN_CHUNK_SIZE);
      found.push(
        ...(await transaction.memory.findMany({
          select: { agentUsername: true, id: true },
          where: { originPostId: { in: chunk } }
        }))
      );
    }
    return found;
  }

  /** §8.4 — the listing as an operator reads it, oldest first like the agent's, with how each was revised */
  async listWithRevisions(agentUsername: string): Promise<MemoryListingWithRevisions[]> {
    const entries = await this.memories.findMany({
      orderBy: { createdAt: 'asc' },
      select: { description: true, id: true, revisedAt: true, revision: true },
      where: { agentUsername }
    });
    return entries.map(({ id, ...entry }) => ({ ...entry, reference: renderMemoryReference(id) }));
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
   * §3.6 — one step: the stored body is read and revised in place under the per-agent lock, so the
   * entry keeps its reference and its place in the listing. The entry count does not change, so
   * nothing is evicted; the revision counts as a use.
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
      const revisedAt = new Date();
      const entry = await this.memories.update({
        data: {
          body: body.value,
          lastUsedAt: revisedAt,
          originPostId: revision.originPostId,
          revisedAt,
          revision: current.value.revision + 1
        },
        where: { id: current.value.id }
      });
      return Result.ok({ entry, reference: renderMemoryReference(entry.id) });
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
