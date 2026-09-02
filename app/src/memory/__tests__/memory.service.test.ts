import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import type { ModelRow } from '@/prisma/prisma.types.ts';
import { getModelToken } from '@/prisma/prisma.utils.ts';
import { createModelTable } from '@/testing/factories/model-table.factory.ts';

import { MemoryLockService } from '../locks/memory-lock.service.ts';
import { MemoryService } from '../memory.service.ts';

const CAPS = { maxBodyChars: 20, maxDescriptionChars: 10, maxEntries: 2 };

/** ids are longer than a reference, so a test that resolves one is exercising the prefix lookup */
const buildId = (sequence: number, suffix = 'abcdefghijklmnop') => `memory-${sequence}-${suffix}`;

const entry = (overrides: Partial<ModelRow<'Memory'>> = {}): ModelRow<'Memory'> => ({
  agentUsername: 'mira',
  body: 'body',
  createdAt: new Date(),
  description: 'a fact',
  id: buildId(0),
  originPostId: 'post-1',
  ...overrides
});

/** the delegate is faked with real state because the lock is only observable against real state */
const createMemoryTable = () =>
  createModelTable<ModelRow<'Memory'>>({
    defaults: (sequence) => ({ createdAt: new Date(sequence), id: buildId(sequence) })
  });

describe('MemoryService', () => {
  let memoryService: MemoryService;
  let table: ReturnType<typeof createMemoryTable>;

  beforeEach(async () => {
    table = createMemoryTable();
    const moduleRef = await Test.createTestingModule({
      providers: [MemoryLockService, MemoryService, { provide: getModelToken('Memory'), useValue: table }]
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
    it('should evict the oldest entry once the entry cap is reached', async () => {
      await write({ description: 'first' });
      await write({ description: 'second' });
      await write({ description: 'third' });
      expect(table.rows.map((row) => row.description)).toStrictEqual(['second', 'third']);
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

    it('should keep memory per-agent, never shared between agents', async () => {
      await write();
      expect((await memoryService.read('tess', 'memory-0')).error).toStrictEqual({
        kind: 'not-found',
        reference: 'memory-0'
      });
      expect(await memoryService.list('tess')).toStrictEqual([]);
    });
  });

  describe('delete', () => {
    it('should remove the agent’s own entry by reference', async () => {
      await write();
      expect((await memoryService.delete('mira', 'memory-0')).success).toBe(true);
      expect(table.rows).toHaveLength(0);
    });

    it('should refuse to delete another agent’s entry', async () => {
      await write();
      expect((await memoryService.delete('tess', 'memory-0')).error).toMatchObject({ kind: 'not-found' });
      expect(table.rows).toHaveLength(1);
    });
  });
});
