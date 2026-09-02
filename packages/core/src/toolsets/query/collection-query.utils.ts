import { isPlainObject } from 'es-toolkit';

import type { CollectionFieldCondition, CollectionQuery, CollectionScalar } from './collection-query.types.ts';

type Condition = CollectionFieldCondition<CollectionScalar>;

/** folds ASCII letters only, matching SQLite's `lower()` without ICU, so the store and this evaluator agree on every string */
const foldAsciiCase = (text: string): string => text.replace(/[A-Z]+/g, (upper) => upper.toLowerCase());

const readField = (value: unknown, field: string): unknown => (isPlainObject(value) ? value[field] : undefined);

const matchesScalar = (actual: unknown, expected: CollectionScalar): boolean =>
  expected === null ? actual === null || actual === undefined : actual === expected;

const matchesCondition = (actual: unknown, condition: Condition): boolean => {
  if (condition === null || typeof condition !== 'object') {
    return matchesScalar(actual, condition);
  }
  if ('in' in condition) {
    return condition.in.some((candidate) => matchesScalar(actual, candidate));
  }
  return typeof actual === 'string' && foldAsciiCase(actual).includes(foldAsciiCase(condition.contains));
};

/** the stated conditions of a query, by field, an undefined one dropped as unstated */
export function collectionQueryConditions(query: CollectionQuery<unknown>): [field: string, condition: Condition][] {
  const conditions: [string, Condition][] = [];
  for (const [field, condition] of Object.entries(query.where ?? {})) {
    if (condition !== undefined) {
      conditions.push([field, condition]);
    }
  }
  return conditions;
}

/** the query over entries already in memory, in the entries' own order — the semantics the store's compiled form must reproduce */
export function applyCollectionQuery<TEntry extends { readonly value: unknown }>(
  entries: readonly TEntry[],
  query: CollectionQuery<unknown>
): TEntry[] {
  const conditions = collectionQueryConditions(query);
  const matching = entries.filter(({ value }) =>
    conditions.every(([field, condition]) => matchesCondition(readField(value, field), condition))
  );
  return query.limit === undefined ? matching : matching.slice(0, query.limit);
}
