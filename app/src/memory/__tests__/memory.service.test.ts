import { Result } from '@collegium/core/utils';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { PrismaService } from '@/prisma/prisma.service.ts';
import type { ModelRow } from '@/prisma/prisma.types.ts';
import { getModelToken } from '@/prisma/prisma.utils.ts';
import { createModelTable } from '@/testing/factories/model-table.factory.ts';

import { MemoryLockService } from '../locks/memory-lock.service.ts';
import { MemoryService } from '../memory.service.ts';
import { appendToBody, replaceSinglePassage } from '../memory.utils.ts';

const CAPS = { maxBodyChars: 20, maxDescriptionChars: 10, maxEntries: 2 };

/** ids are longer than a reference, so a test that resolves one is exercising the prefix lookup */
const buildId = (sequence: number, suffix = 'abcdefghijklmnop') => `memory-${sequence}-${suffix}`;

const entry = (overrides: Partial<ModelRow<'Memory'>> = {}): ModelRow<'Memory'> => ({
  agentUsername: 'mira',
  body: 'body',
  createdAt: new Date(),
  description: 'a fact',
  id: buildId(0),
  lastUsedAt: new Date(),
  originPostId: 'post-1',
  ...overrides
});

/** the delegate is faked with real state because the lock is only observable against real state */
const createMemoryTable = () => {
  return createModelTable<ModelRow<'Memory'>>({
    defaults: (sequence) => ({
      createdAt: new Date(sequence),
      id: buildId(sequence),
      lastUsedAt: new Date(sequence)
    })
  });
};

describe('MemoryService', () => {
  let memoryService: MemoryService;
  let table: ReturnType<typeof createMemoryTable>;

  beforeEach(async () => {
    table = createMemoryTable();
    const moduleRef = await Test.createTestingModule({
      providers: [
        MemoryLockService,
        MemoryService,
        { provide: getModelToken('Memory'), useValue: table },
        { provide: PrismaService, useValue: { $transaction: (run: any) => run({ memory: table }) } }
      ]
    }).compile();
    memoryService = moduleRef.get(MemoryService);
  });

  const write = (overrides: Partial<ModelRow<'Memory'>> = {}) => {
    const { agentUsername, body, description, originPostId } = entry(overrides);
    return memoryService.write({ agentUsername, body, description, originPostId }, CAPS);
  };

  it('should record written-at and the originating post id on every entry', async () => {
    const result = await write({ originPostId: 'post-9' });
    expect(result.value?.entry).toMatchObject({ originPostId: 'post-9' });
    expect(result.value?.entry.createdAt).toBeInstanceOf(Date);
  });

  it('should report an eight-character reference for the entry it wrote', async () => {
    const result = await write();
    expect(result.value?.reference).toBe('memory-0');
  });

  describe('caps', () => {
    it('should evict the oldest-created entry once the entry cap is reached, when nothing was ever read', async () => {
      await write({ description: 'first' });
      await write({ description: 'second' });
      await write({ description: 'third' });
      expect(table.rows.map((row) => row.description)).toStrictEqual(['second', 'third']);
    });

    it('should evict the least recently used entry, not the oldest written (§3.6)', async () => {
      await write({ description: 'first' });
      await write({ description: 'second' });
      await memoryService.markUsed(buildId(0));
      const result = await write({ description: 'third' });
      expect(table.rows.map((row) => row.description)).toStrictEqual(['first', 'third']);
      expect(result.value?.evictedDescriptions).toStrictEqual(['second']);
    });

    it('should refuse a description longer than the cap rather than truncate it', async () => {
      const result = await write({ description: 'x'.repeat(11) });
      expect(result.error).toStrictEqual({ field: 'description', kind: 'too-long', length: 11, limit: 10 });
      expect(table.rows).toHaveLength(0);
    });

    it('should refuse a body longer than the cap rather than truncate it', async () => {
      const result = await write({ body: 'x'.repeat(21) });
      expect(result.error).toMatchObject({ field: 'body', kind: 'too-long' });
      expect(table.rows).toHaveLength(0);
    });

    it('should hold the per-agent lock, so two writes racing at the cap leave exactly maxEntries', async () => {
      await write();
      await write();
      await Promise.all([write(), write()]);
      expect(table.rows).toHaveLength(CAPS.maxEntries);
    });
  });

  describe('read', () => {
    it('should list references with descriptions oldest first, and return a body only on read', async () => {
      await write({ body: 'the first body', description: 'first' });
      await write({ description: 'second' });
      expect(await memoryService.list('mira')).toStrictEqual([
        { description: 'first', reference: 'memory-0' },
        { description: 'second', reference: 'memory-1' }
      ]);
      expect((await memoryService.read('mira', 'memory-0')).value?.body).toBe('the first body');
    });

    it('should resolve a full id as well as its reference', async () => {
      const { value } = await write();
      expect((await memoryService.read('mira', value!.entry.id)).value?.id).toBe(value!.entry.id);
    });

    it('should refuse a reference matching more than one entry rather than guess', async () => {
      await table.create({ data: entry({ id: buildId(0, 'first') }) });
      await table.create({ data: entry({ id: buildId(0, 'second') }) });
      expect((await memoryService.read('mira', 'memory-0')).error).toStrictEqual({
        kind: 'ambiguous',
        reference: 'memory-0'
      });
    });

    it('should leave the listing oldest-created first after an entry is marked used', async () => {
      await write({ description: 'first' });
      await write({ description: 'second' });
      await memoryService.markUsed(buildId(0));
      expect((await memoryService.list('mira')).map(({ description }) => description)).toStrictEqual([
        'first',
        'second'
      ]);
    });

    it('should treat marking a since-deleted entry used as a no-op rather than a throw', async () => {
      await expect(memoryService.markUsed(buildId(9))).resolves.toBeUndefined();
    });

    it('should keep memory per-agent, never shared between agents', async () => {
      await write();
      expect((await memoryService.read('tess', 'memory-0')).error).toStrictEqual({
        kind: 'not-found',
        reference: 'memory-0'
      });
      expect(await memoryService.list('tess')).toStrictEqual([]);
    });
  });

  describe('revise', () => {
    const revision = { agentUsername: 'mira', originPostId: 'post-2', reference: 'memory-0' };

    it('should write the revised body under a new reference and delete the old entry (§3.6)', async () => {
      await write({ body: 'first', description: 'ledger' });
      const revised = await memoryService.revise(revision, (body) => Result.ok(appendToBody(body, 'second')), CAPS);
      expect(revised.value).toMatchObject({ reference: 'memory-1', revisionOf: 'memory-0' });
      expect(table.rows).toStrictEqual([
        expect.objectContaining({ body: 'first\nsecond', description: 'ledger', originPostId: 'post-2' })
      ]);
    });

    it('should substitute a passage that occurs exactly once', async () => {
      await write({ body: 'call by phone' });
      await memoryService.revise(revision, (body) => replaceSinglePassage(body, 'phone', 'email'), CAPS);
      expect(table.rows.map((row) => row.body)).toStrictEqual(['call by email']);
    });

    it.each([
      { label: 'nowhere', occurrences: 'none', passage: 'fax' },
      { label: 'twice', occurrences: 'several', passage: 'phone' }
    ])('should refuse a passage that occurs $label, writing nothing (§3.6)', async ({ occurrences, passage }) => {
      await write({ body: 'phone, then phone' });
      const revised = await memoryService.revise(revision, (body) => replaceSinglePassage(body, passage, ''), CAPS);
      expect(revised.error).toStrictEqual({ kind: 'passage-unmatched', occurrences });
      expect(table.rows.map((row) => row.body)).toStrictEqual(['phone, then phone']);
    });

    it('should refuse a revision that leaves the body empty, writing nothing', async () => {
      await write({ body: 'phone' });
      const revised = await memoryService.revise(revision, (body) => replaceSinglePassage(body, 'phone', ''), CAPS);
      expect(revised.error).toStrictEqual({ kind: 'empty-body' });
      expect(table.rows.map((row) => row.body)).toStrictEqual(['phone']);
    });

    it('should refuse a revised body over the cap without writing', async () => {
      await write({ body: 'x'.repeat(15) });
      const revised = await memoryService.revise(
        revision,
        (body) => Result.ok(appendToBody(body, 'y'.repeat(9))),
        CAPS
      );
      expect(revised.error).toStrictEqual({ field: 'body', kind: 'too-long', length: 25, limit: 20 });
      expect(table.rows.map((row) => row.id)).toStrictEqual([buildId(0)]);
    });
  });

  describe('delete', () => {
    it('should remove the agent’s own entry by reference and report what it removed', async () => {
      await write({ description: 'stale' });
      const deleted = await memoryService.delete('mira', 'memory-0');
      expect(deleted.value?.description).toBe('stale');
      expect(table.rows).toHaveLength(0);
    });

    it('should hold the per-agent lock, so a delete racing a write at the cap evicts nothing extra', async () => {
      await write({ description: 'first' });
      await write({ description: 'second' });
      await Promise.all([memoryService.delete('mira', 'memory-0'), write({ description: 'third' })]);
      expect(table.rows.map((row) => row.description)).toStrictEqual(['second', 'third']);
    });

    it('should refuse to delete another agent’s entry', async () => {
      await write();
      expect((await memoryService.delete('tess', 'memory-0')).error).toMatchObject({ kind: 'not-found' });
      expect(table.rows).toHaveLength(1);
    });
  });
});
