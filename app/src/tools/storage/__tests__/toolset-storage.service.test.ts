import { applyCollectionQuery } from '@collegium/core/toolsets';
import type { CollectionQuery, ToolsetCollection } from '@collegium/core/toolsets';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { PrismaService } from '@/prisma/prisma.service.ts';
import { getModelToken } from '@/prisma/prisma.utils.ts';
import { createMigratedDatabase } from '@/testing/factories/migrated-database.factory.ts';
import type { MigratedDatabase } from '@/testing/factories/migrated-database.factory.ts';

import { ToolsetStorageService } from '../toolset-storage.service.ts';

const $Investigator = z.object({
  active: z.boolean(),
  email: z.string().nullable().optional(),
  name: z.string(),
  score: z.number(),
  tags: z.array(z.string()).optional()
});

const ENTRIES = [
  { key: 'ana', value: { active: true, email: 'ana@example.com', name: 'Ana Émile', score: 2 } },
  { key: 'ben', value: { active: false, email: null, name: 'Ben', score: 2.5 } },
  { key: 'cid', value: { active: true, name: 'Cid', score: 7, tags: ['x'] } }
];

const QUERIES: CollectionQuery<z.infer<typeof $Investigator>>[] = [
  {},
  { where: { score: 2 } },
  { where: { score: 2.5 } },
  { where: { active: true } },
  { where: { active: false } },
  { where: { email: null } },
  { where: { email: 'ana@example.com' } },
  { where: { name: { in: ['Ben', 'Cid'] } } },
  { where: { email: { in: [null, 'ana@example.com'] } } },
  { where: { name: { in: [] } } },
  { where: { name: { contains: 'AN' } } },
  { where: { name: { contains: 'émile' } } },
  { where: { name: { contains: '' } } },
  { limit: 1, where: { active: true, name: undefined, score: { in: [2, 7] } } },
  { limit: 0 }
];

describe('ToolsetStorageService', () => {
  let database: MigratedDatabase;
  let investigators: ToolsetCollection<unknown>;
  let other: ToolsetCollection<unknown>;

  beforeAll(async () => {
    database = createMigratedDatabase();
    const moduleRef = await Test.createTestingModule({
      providers: [
        ToolsetStorageService,
        { provide: PrismaService, useValue: database.client },
        { provide: getModelToken('ToolsetRecord'), useValue: database.client.toolsetRecord }
      ]
    }).compile();
    const service = moduleRef.get(ToolsetStorageService);
    investigators = service.collection('prospects', 'investigators', $Investigator);
    other = service.collection('prospects', 'other', $Investigator);
    for (const entry of ENTRIES) {
      await investigators.put(entry.key, entry.value);
    }
    await other.put('ana', ENTRIES[0]!.value);
  });

  afterAll(() => database.dispose());

  it('round-trips a value through the store', async () => {
    expect(await investigators.get('ben')).toStrictEqual(ENTRIES[1]!.value);
    expect(await investigators.get('missing')).toBeNull();
    expect(await investigators.list()).toStrictEqual(ENTRIES);
  });

  it.each(QUERIES)('finds what the in-memory evaluator finds for %j', async (query) => {
    expect(await investigators.find(query)).toStrictEqual(applyCollectionQuery(ENTRIES, query));
  });

  it('never reaches another collection through find', async () => {
    expect(await other.find({ where: { name: { contains: 'a' } } })).toStrictEqual([ENTRIES[0]]);
  });

  it('deletes by key and reports whether a row went', async () => {
    const scratch = ENTRIES[2]!;
    expect(await investigators.delete(scratch.key)).toBe(true);
    expect(await investigators.delete(scratch.key)).toBe(false);
    await investigators.put(scratch.key, scratch.value);
  });
});
