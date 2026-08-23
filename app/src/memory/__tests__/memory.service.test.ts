import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import type { ModelRow } from '@/prisma/prisma.types.ts';
import { getModelToken } from '@/prisma/prisma.utils.ts';
import { createModelTable } from '@/testing/factories/model-table.factory.ts';

import { MemoryLockService } from '../locks/memory-lock.service.ts';
import { MemoryService } from '../memory.service.ts';

const CAPS = { maxBodyChars: 20, maxDescriptionChars: 10, maxEntries: 2 };

const entry = (overrides: Partial<ModelRow<'Memory'>> = {}): ModelRow<'Memory'> => ({
  agentUsername: 'mira',
  body: 'body',
  createdAt: new Date(),
  description: 'a fact',
  id: 'memory-0',
  originPostId: 'post-1',
  ...overrides
});

/** the delegate is faked with real state because the lock is only observable against real state */
const createMemoryTable = () =>
  createModelTable<ModelRow<'Memory'>>({
    defaults: (sequence) => ({ createdAt: new Date(sequence), id: `memory-${sequence}` })
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
    it('should list whole entries oldest first', async () => {
      await write({ description: 'first' });
      await write({ description: 'second' });
      expect((await memoryService.list('mira')).map(({ description }) => description)).toStrictEqual([
        'first',
        'second'
      ]);
    });

    it('should list descriptions without bodies, and return a body only on read', async () => {
      const { value } = await write({ body: 'the whole body' });
      expect(await memoryService.listDescriptions('mira')).toStrictEqual([
        { description: 'a fact', id: value!.entry.id }
      ]);
      expect((await memoryService.read('mira', value!.entry.id)).value?.body).toBe('the whole body');
    });

    it('should keep memory per-agent, never shared between agents', async () => {
      const { value } = await write();
      expect((await memoryService.read('tess', value!.entry.id)).error).toStrictEqual({
        id: value!.entry.id,
        kind: 'not-found'
      });
      expect(await memoryService.listDescriptions('tess')).toStrictEqual([]);
    });
  });

  describe('delete', () => {
    it('should remove the agent’s own entry', async () => {
      const { value } = await write();
      expect((await memoryService.delete('mira', value!.entry.id)).success).toBe(true);
      expect(table.rows).toHaveLength(0);
    });

    it('should refuse to delete another agent’s entry', async () => {
      const { value } = await write();
      expect((await memoryService.delete('tess', value!.entry.id)).success).toBe(false);
      expect(table.rows).toHaveLength(1);
    });
  });
});
