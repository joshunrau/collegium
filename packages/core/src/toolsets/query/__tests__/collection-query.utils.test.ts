import { describe, expect, it } from 'vitest';

import { applyCollectionQuery } from '../collection-query.utils.ts';

const ENTRIES = [
  { key: 'ana', value: { active: true, email: 'ana@example.com', name: 'Ana Émile', score: 2 } },
  { key: 'ben', value: { active: false, email: null, name: 'Ben', score: 2.5 } },
  { key: 'cid', value: { active: true, name: 'Cid', score: 7, tags: ['x'] } },
  { key: 'raw', value: 'not an object' }
];

const keysOf = (entries: { key: string }[]) => entries.map((entry) => entry.key);

describe('applyCollectionQuery', () => {
  it('returns every entry in order when nothing is constrained', () => {
    expect(keysOf(applyCollectionQuery(ENTRIES, {}))).toStrictEqual(['ana', 'ben', 'cid', 'raw']);
  });

  it('matches scalar equality by type and value, and null against a missing field', () => {
    expect(keysOf(applyCollectionQuery(ENTRIES, { where: { score: 2 } }))).toStrictEqual(['ana']);
    expect(keysOf(applyCollectionQuery(ENTRIES, { where: { active: true } }))).toStrictEqual(['ana', 'cid']);
    expect(keysOf(applyCollectionQuery(ENTRIES, { where: { email: null } }))).toStrictEqual(['ben', 'cid', 'raw']);
    expect(keysOf(applyCollectionQuery(ENTRIES, { where: { score: '2' } }))).toStrictEqual([]);
  });

  it('matches membership, including null, and nothing against an empty list', () => {
    expect(keysOf(applyCollectionQuery(ENTRIES, { where: { name: { in: ['Ben', 'Cid'] } } }))).toStrictEqual([
      'ben',
      'cid'
    ]);
    expect(keysOf(applyCollectionQuery(ENTRIES, { where: { email: { in: [null] } } }))).toStrictEqual([
      'ben',
      'cid',
      'raw'
    ]);
    expect(keysOf(applyCollectionQuery(ENTRIES, { where: { name: { in: [] } } }))).toStrictEqual([]);
  });

  it('matches a substring on string fields only, folding ASCII case', () => {
    expect(keysOf(applyCollectionQuery(ENTRIES, { where: { name: { contains: 'AN' } } }))).toStrictEqual(['ana']);
    expect(keysOf(applyCollectionQuery(ENTRIES, { where: { name: { contains: 'émile' } } }))).toStrictEqual([]);
    expect(keysOf(applyCollectionQuery(ENTRIES, { where: { score: { contains: '2' } } }))).toStrictEqual([]);
  });

  it('ands the conditions, skips an undefined one, and applies the limit after filtering', () => {
    const query = { limit: 1, where: { active: true, name: undefined, score: { in: [2, 7] } } };
    expect(keysOf(applyCollectionQuery(ENTRIES, query))).toStrictEqual(['ana']);
  });
});
