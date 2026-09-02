import { collectionQueryConditions } from '@collegium/core/toolsets';
import type { CollectionFieldCondition, CollectionQuery, CollectionScalar } from '@collegium/core/toolsets';

type Statement = {
  readonly params: readonly (number | string)[];
  readonly sql: string;
};

/**
 * Every predicate checks `json_type` beside the value, because `json_extract` collapses JSON
 * types onto SQLite's — `true` reads as the integer 1 and a missing key as NULL — and the
 * in-memory evaluator distinguishes them.
 */
const compileScalar = (path: string, expected: CollectionScalar): Statement => {
  switch (typeof expected) {
    case 'boolean':
      return { params: [path, String(expected)], sql: 'json_type("payload", ?) = ?' };
    case 'number':
      return {
        params: [path, path, expected],
        sql: `json_type("payload", ?) IN ('integer', 'real') AND json_extract("payload", ?) = ?`
      };
    case 'string':
      return {
        params: [path, path, expected],
        sql: `json_type("payload", ?) = 'text' AND json_extract("payload", ?) = ?`
      };
    default:
      return { params: [path], sql: `coalesce(json_type("payload", ?), 'null') = 'null'` };
  }
};

const compileCondition = (field: string, condition: CollectionFieldCondition<CollectionScalar>): Statement => {
  const path = `$.value."${field}"`;
  if (condition === null || typeof condition !== 'object') {
    return compileScalar(path, condition);
  }
  if ('in' in condition) {
    const alternatives = condition.in.map((candidate) => compileScalar(path, candidate));
    return {
      params: alternatives.flatMap((alternative) => alternative.params),
      sql: alternatives.length === 0 ? '0' : alternatives.map((alternative) => `(${alternative.sql})`).join(' OR ')
    };
  }
  return {
    params: [path, path, condition.contains],
    sql: `json_type("payload", ?) = 'text' AND instr(lower(json_extract("payload", ?)), lower(?)) > 0`
  };
};

export type CompiledStatement = Statement;

/** the ids of the rows the query matches, in the order `list` reports them; the caller reads the rows back through the typed client */
export function compileCollectionQuery(
  scope: { readonly collection: string; readonly namespace: string },
  query: CollectionQuery<unknown>
): CompiledStatement {
  const clauses = collectionQueryConditions(query).map(([field, condition]) => compileCondition(field, condition));
  const where = ['"namespace" = ?', '"collection" = ?', ...clauses.map((clause) => `(${clause.sql})`)].join(' AND ');
  const limit = query.limit === undefined ? '' : ' LIMIT ?';
  return {
    params: [
      scope.namespace,
      scope.collection,
      ...clauses.flatMap((clause) => clause.params),
      ...(query.limit === undefined ? [] : [query.limit])
    ],
    sql: `SELECT "id" FROM "ToolsetRecord" WHERE ${where} ORDER BY "createdAt" ASC, "id" ASC${limit}`
  };
}
