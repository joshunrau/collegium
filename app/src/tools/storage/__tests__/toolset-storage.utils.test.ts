import { describe, expect, it } from 'vitest';

import { compileCollectionQuery } from '../toolset-storage.utils.ts';

const SCOPE = { collection: 'rows', namespace: 'fake' };

describe('compileCollectionQuery', () => {
  it('scopes an unconstrained query to the collection in insertion order', () => {
    expect(compileCollectionQuery(SCOPE, {})).toStrictEqual({
      params: ['fake', 'rows'],
      sql: 'SELECT "id" FROM "ToolsetRecord" WHERE "namespace" = ? AND "collection" = ? ORDER BY "createdAt" ASC, "id" ASC'
    });
  });

  it('binds every field path and value as a parameter and appends the limit last', () => {
    const { params, sql } = compileCollectionQuery(SCOPE, {
      limit: 3,
      where: { active: true, gone: null, name: { contains: 'A' }, score: { in: [1, 'x'] } }
    });
    expect(sql).not.toMatch(/active|gone|"name"|score/);
    expect(sql).toMatch(/ LIMIT \?$/);
    expect(params).toStrictEqual([
      'fake',
      'rows',
      '$.value."active"',
      'true',
      '$.value."gone"',
      '$.value."name"',
      '$.value."name"',
      'A',
      '$.value."score"',
      '$.value."score"',
      1,
      '$.value."score"',
      '$.value."score"',
      'x',
      3
    ]);
  });

  it('compiles an id condition against the column, matching nothing for a non-string', () => {
    const { params, sql } = compileCollectionQuery(SCOPE, { where: { id: { in: ['a', 1] } } });
    expect(sql).toContain('(("id" = ?) OR (0))');
    expect(params).toStrictEqual(['fake', 'rows', 'a']);
    expect(compileCollectionQuery(SCOPE, { where: { id: { contains: 'a' } } }).sql).toContain('lower("id")');
  });

  it('compiles an empty membership list to a predicate that matches nothing', () => {
    expect(compileCollectionQuery(SCOPE, { where: { name: { in: [] } } }).sql).toContain('AND (0)');
  });
});
