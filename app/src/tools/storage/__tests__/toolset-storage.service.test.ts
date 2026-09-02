import { applyCollectionQuery } from '@collegium/core/toolsets';
import type { CollectionQuery, CollectionRecord, ToolsetCollection } from '@collegium/core/toolsets';
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
  name: z.string().min(1),
  score: z.number().default(0),
  tags: z.array(z.string()).optional()
});

type Investigator = CollectionRecord<z.output<typeof $Investigator>>;

const SEED = [
  { active: true, email: 'ana@example.com', id: 'ana', name: 'Ana Émile', score: 2 },
  { active: false, email: null, id: 'ben', name: 'Ben', score: 2.5 },
  { active: true, id: 'cid', name: 'Cid', score: 7, tags: ['x'] }
];

const QUERIES: CollectionQuery<Investigator>[] = [
  {},
  { where: { score: 2 } },
  { where: { score: 2.5 } },
  { where: { active: true } },
  { where: { active: false } },
  { where: { email: null } },
  { where: { email: 'ana@example.com' } },
  { where: { id: 'ben' } },
  { where: { id: { in: ['ana', 'cid'] } } },
  { where: { id: { contains: 'A' } } },
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
  let investigators: ToolsetCollection<typeof $Investigator>;
  let other: ToolsetCollection<typeof $Investigator>;
  let records: Investigator[];

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
    records = [];
    for (const data of SEED) {
      records.push(await investigators.create(data));
    }
    await other.create(SEED[0]!);
  });

  afterAll(() => database.dispose());

  it('creates a record with the given id, the stamp, and the schema defaults applied', async () => {
    const created = await investigators.create({ active: true, name: 'Dee' });
    expect(created).toMatchObject({ active: true, name: 'Dee', score: 0 });
    expect(created.id).toMatch(/^[a-z0-9]{24}$/);
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(await investigators.deleteById(created.id)).toBe(true);
  });

  it('refuses a second record under an id the collection already holds', async () => {
    await expect(investigators.create({ active: true, id: 'ana', name: 'Ana again' })).rejects.toThrow(
      'already holds a record with id "ana"'
    );
  });

  it('finds by id, or null', async () => {
    expect(await investigators.findById('ben')).toStrictEqual(records[1]);
    expect(await investigators.findById('missing')).toBeNull();
  });

  it.each(QUERIES)('finds what the in-memory evaluator finds for %j', async (query) => {
    expect(await investigators.findMany(query)).toStrictEqual(applyCollectionQuery(records, query));
  });

  it('never reaches another collection through a query', async () => {
    expect(await other.findMany({ where: { name: { contains: 'a' } } })).toMatchObject([{ id: 'ana' }]);
  });

  it('updates by merging the patch and parsing the whole, or returns null', async () => {
    const updated = await investigators.updateById('cid', { score: 8 });
    expect(updated).toMatchObject({ id: 'cid', name: 'Cid', score: 8, tags: ['x'] });
    expect(updated!.updatedAt.getTime()).toBeGreaterThanOrEqual(records[2]!.updatedAt.getTime());
    await expect(investigators.updateById('cid', { name: '' })).rejects.toThrow(z.ZodError);
    expect(await investigators.updateById('missing', { score: 1 })).toBeNull();
    await investigators.updateById('cid', { score: 7 });
  });

  it('deletes by id and reports whether a row went', async () => {
    expect(await investigators.deleteById('cid')).toBe(true);
    expect(await investigators.deleteById('cid')).toBe(false);
    records[2] = await investigators.create(SEED[2]!);
  });
});
