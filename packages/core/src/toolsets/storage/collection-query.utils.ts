import { isPlainObject } from 'es-toolkit';

import type {
  CollectionFieldCondition,
  CollectionQuery,
  CollectionScalar,
  LooseCollectionWhere
} from './collection-query.types.ts';

type Condition = CollectionFieldCondition<CollectionScalar>;

/** folds ASCII letters only, matching SQLite's `lower()` without ICU, so the store and this evaluator agree on every string */
const foldAsciiCase = (text: string): string => text.replace(/[A-Z]+/g, (upper) => upper.toLowerCase());

const readField = (record: unknown, field: string): unknown => (isPlainObject(record) ? record[field] : undefined);

const matchesScalar = (actual: unknown, expected: CollectionScalar): boolean => {
  return expected === null ? actual === null || actual === undefined : actual === expected;
};

const matchesCondition = (actual: unknown, condition: Condition): boolean => {
  if (condition === null || typeof condition !== 'object') {
    return matchesScalar(actual, condition);
  }
  if ('in' in condition) {
    return condition.in.some((candidate) => matchesScalar(actual, candidate));
  }
  return typeof actual === 'string' && foldAsciiCase(actual).includes(foldAsciiCase(condition.contains));
};

const readConditions = (where: LooseCollectionWhere | undefined): [string, Condition][] => {
  const conditions: [string, Condition][] = [];
  for (const [field, condition] of Object.entries(where ?? {})) {
    if (condition !== undefined) {
      conditions.push([field, condition]);
    }
  }
  return conditions;
};

/** the stated conditions of a query, by field, an undefined one dropped as unstated */
export function collectionQueryConditions<TRecord>(
  query: CollectionQuery<TRecord>
): [field: string, condition: Condition][] {
  return readConditions(query.where);
}

/** the query over records already in memory, in their own order — the semantics the store's compiled form must reproduce */
export function applyCollectionQuery<TRecord extends object>(
  records: readonly TRecord[],
  query: CollectionQuery<TRecord>
): TRecord[] {
  const conditions = collectionQueryConditions(query);
  const matching = records.filter((record) => {
    return conditions.every(([field, condition]) => matchesCondition(readField(record, field), condition));
  });
  return query.limit === undefined ? matching : matching.slice(0, query.limit);
}
