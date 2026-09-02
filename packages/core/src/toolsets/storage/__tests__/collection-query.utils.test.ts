import { describe, expect, it } from 'vitest';

import { applyCollectionQuery } from '../collection-query.utils.ts';

const RECORDS = [
  { active: true, email: 'ana@example.com', id: 'ana', name: 'Ana Émile', score: 2 },
  { active: false, email: null, id: 'ben', name: 'Ben', score: 2.5 },
  { active: true, id: 'cid', name: 'Cid', score: 7, tags: ['x'] }
];

const idsOf = (records: { id: string }[]) => records.map((record) => record.id);

describe('applyCollectionQuery', () => {
  it('returns every record in order when nothing is constrained', () => {
    expect(idsOf(applyCollectionQuery(RECORDS, {}))).toStrictEqual(['ana', 'ben', 'cid']);
  });

  it('matches scalar equality by type and value, and null against a missing field', () => {
    expect(idsOf(applyCollectionQuery(RECORDS, { where: { score: 2 } }))).toStrictEqual(['ana']);
    expect(idsOf(applyCollectionQuery(RECORDS, { where: { active: true } }))).toStrictEqual(['ana', 'cid']);
    expect(idsOf(applyCollectionQuery(RECORDS, { where: { email: null } }))).toStrictEqual(['ben', 'cid']);
    expect(idsOf(applyCollectionQuery(RECORDS, { where: { id: 'ben' } }))).toStrictEqual(['ben']);
  });

  it('matches membership, including null, and nothing against an empty list', () => {
    expect(idsOf(applyCollectionQuery(RECORDS, { where: { name: { in: ['Ben', 'Cid'] } } }))).toStrictEqual([
      'ben',
      'cid'
    ]);
    expect(idsOf(applyCollectionQuery(RECORDS, { where: { email: { in: [null] } } }))).toStrictEqual(['ben', 'cid']);
    expect(idsOf(applyCollectionQuery(RECORDS, { where: { name: { in: [] } } }))).toStrictEqual([]);
  });

  it('matches a substring on string fields, folding ASCII case', () => {
    expect(idsOf(applyCollectionQuery(RECORDS, { where: { name: { contains: 'AN' } } }))).toStrictEqual(['ana']);
    expect(idsOf(applyCollectionQuery(RECORDS, { where: { name: { contains: 'émile' } } }))).toStrictEqual([]);
  });

  it('ands the conditions, skips an undefined one, and applies the limit after filtering', () => {
    const query = { limit: 1, where: { active: true, name: undefined, score: { in: [2, 7] } } };
    expect(idsOf(applyCollectionQuery(RECORDS, query))).toStrictEqual(['ana']);
  });
});
