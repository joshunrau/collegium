import { beforeEach, describe, expect, it } from 'vitest';

import { createModelTable } from '../model-table.factory.ts';

type Row = {
  channelId: string;
  endedAt: Date | null;
  id: string;
  score: number;
  startedAt: Date;
  turnId: null | string;
};

const at = (minutes: number) => new Date(Date.UTC(2026, 0, 1, 0, minutes));

const createTable = () =>
  createModelTable<Row>({
    defaults: (sequence) => ({ endedAt: null, id: `row-${sequence}`, score: 0, turnId: 'turn-1' }),
    relations: {
      channel: (row) => ({ id: row.channelId }),
      turn: (row) => (row.turnId === null ? null : { agentUsername: 'mira', id: row.turnId })
    },
    uniqueFields: ['id']
  });

const ids = (rows: unknown[]) => rows.map((row) => (row as Row).id);

describe('createModelTable', () => {
  let table: ReturnType<typeof createTable>;

  beforeEach(async () => {
    table = createTable();
    await table.create({ data: { channelId: 'c1', score: 2, startedAt: at(0) } });
    await table.create({ data: { channelId: 'c2', score: 1, startedAt: at(1) } });
    await table.create({ data: { channelId: 'c3', score: 1, startedAt: at(2) } });
  });

  it('should fill defaults beneath the provided data and ignore undefined fields', async () => {
    const row = await table.create({ data: { channelId: 'c4', score: undefined, startedAt: at(3) } });
    expect(row).toMatchObject({ id: 'row-3', score: 0, turnId: 'turn-1' });
  });

  it('should reject with P2002 when a unique field is duplicated', async () => {
    const duplicate = table.create({ data: { channelId: 'c4', id: 'row-0', startedAt: at(3) } });
    await expect(duplicate).rejects.toMatchObject({ code: 'P2002' });
  });

  it('should accept a duplicate when no unique field is declared', async () => {
    const permissive = createModelTable<Row>();
    await permissive.create({ data: { id: 'row-0' } });
    await expect(permissive.create({ data: { id: 'row-0' } })).resolves.toMatchObject({ id: 'row-0' });
  });

  it('should count every row when no where clause narrows the query', async () => {
    expect(await table.count({})).toBe(3);
    expect(await table.count({ where: { channelId: 'c1' } })).toBe(1);
  });

  it('should compare date and null conditions by value', async () => {
    expect(ids(await table.findMany({ where: { startedAt: at(1) } }))).toEqual(['row-1']);
    expect(await table.count({ where: { endedAt: at(1) } })).toBe(0);
    expect(await table.count({ where: { endedAt: null } })).toBe(3);
  });

  it('should match an in condition against any listed candidate', async () => {
    const found = await table.findMany({ where: { channelId: { in: ['c1', 'c3'] }, score: undefined } });
    expect(ids(found)).toEqual(['row-0', 'row-2']);
  });

  it('should invert a not condition', async () => {
    expect(ids(await table.findMany({ where: { score: { not: 1 } } }))).toEqual(['row-0']);
  });

  it('should bound numbers with gte and lt', async () => {
    expect(ids(await table.findMany({ where: { score: { gte: 2 } } }))).toEqual(['row-0']);
    expect(ids(await table.findMany({ where: { score: { lt: 2 } } }))).toEqual(['row-1', 'row-2']);
  });

  it('should bound dates with gt and lte', async () => {
    const found = await table.findMany({ where: { startedAt: { gt: at(0), lte: at(1) } } });
    expect(ids(found)).toEqual(['row-1']);
  });

  it('should throw when an unsupported operator meets a scalar', () => {
    expect(() => table.count({ where: { channelId: { contains: 'c' } } })).toThrow(/unsupported where condition/);
  });

  it('should match a condition nested under a relation', async () => {
    const found = await table.findMany({ where: { turn: { agentUsername: 'mira', id: undefined } } });
    expect(ids(found)).toEqual(['row-0', 'row-1', 'row-2']);
  });

  it('should order rows by one clause in either direction', async () => {
    expect(ids(await table.findMany({ orderBy: { score: 'asc' } }))).toEqual(['row-1', 'row-2', 'row-0']);
    expect(ids(await table.findMany({ orderBy: { score: 'desc' } }))).toEqual(['row-0', 'row-1', 'row-2']);
  });

  it('should fall through to the next orderBy clause on a tie', async () => {
    const found = await table.findMany({ orderBy: [{ score: 'asc' }, { startedAt: 'desc' }] });
    expect(ids(found)).toEqual(['row-2', 'row-1', 'row-0']);
  });

  it('should keep insertion order when every orderBy clause ties', async () => {
    expect(ids(await table.findMany({ orderBy: { turnId: 'asc' } }))).toEqual(['row-0', 'row-1', 'row-2']);
  });

  it('should limit findMany to take', async () => {
    expect(ids(await table.findMany({ orderBy: { startedAt: 'asc' }, take: 2 }))).toEqual(['row-0', 'row-1']);
  });

  it('should project only the selected fields', async () => {
    const found = await table.findFirst({ orderBy: { score: 'asc' }, select: { id: true, score: false, turn: true } });
    expect(found).toEqual({ id: 'row-1', turn: { agentUsername: 'mira', id: 'turn-1' } });
  });

  it('should attach an included relation and skip a disabled one', async () => {
    const found = await table.findUnique({ include: { channel: false, turn: true }, where: { id: 'row-0' } });
    expect(found).toMatchObject({ id: 'row-0', turn: { agentUsername: 'mira', id: 'turn-1' } });
    expect(found).not.toHaveProperty('channel');
  });

  it('should narrow an included relation with a nested select', async () => {
    const shape = { select: { agentUsername: false, id: true } };
    const found = await table.findUnique({ include: { turn: shape }, where: { id: 'row-0' } });
    expect((found as { turn: unknown }).turn).toEqual({ id: 'turn-1' });
  });

  it('should leave a null relation untouched under a nested select', async () => {
    await table.create({ data: { channelId: 'c4', startedAt: at(3), turnId: null } });
    const found = await table.findUnique({ include: { turn: { select: { id: true } } }, where: { id: 'row-3' } });
    expect(found).toMatchObject({ turn: null });
  });

  it('should return null when no row matches', async () => {
    expect(await table.findFirst({ where: { id: 'missing' } })).toBeNull();
    expect(await table.findUnique({ where: { id: 'missing' } })).toBeNull();
  });

  it('should merge update data into the matching row', async () => {
    await table.update({ data: { score: 9 }, where: { id: 'row-1' } });
    expect(table.rows[1]).toMatchObject({ score: 9 });
  });

  it('should reject an update that matches no row', async () => {
    await expect(table.update({ data: { score: 9 }, where: { id: 'missing' } })).rejects.toThrow('no row matched');
  });

  it('should update every row matching updateMany', async () => {
    expect(await table.updateMany({ data: { score: 5 }, where: { score: 1 } })).toEqual({ count: 2 });
    expect(await table.count({ where: { score: 5 } })).toBe(2);
  });

  it('should delete every row matching deleteMany', async () => {
    expect(await table.deleteMany({ where: { score: 1 } })).toEqual({ count: 2 });
    expect(ids(table.rows)).toEqual(['row-0']);
  });
});
