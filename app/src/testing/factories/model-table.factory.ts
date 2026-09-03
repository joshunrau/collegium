import { Prisma } from '@/prisma/generated/client.ts';

type OrderByClause = { [field: string]: 'asc' | 'desc' };

type ReadShape = {
  include?: { [name: string]: boolean | { select: { [field: string]: boolean } } };
  select?: { [field: string]: boolean };
};

type ModelTableOptions<TRow> = {
  /** create-time fills applied under the caller's data: generated ids, timestamps, server defaults */
  defaults?: (sequence: number) => Partial<TRow>;
  /** what `include: { name: true }` attaches to a returned row */
  relations?: { [name: string]: (row: TRow) => unknown };
  /** fields whose duplication on create raises the real P2002, as the engine would */
  uniqueFields?: readonly (keyof TRow & string)[];
};

export type ModelTable<TRow extends object> = {
  count: (query: { where?: object }) => Promise<number>;
  create: (query: { data: object }) => Promise<TRow>;
  deleteMany: (query: { where?: object }) => Promise<{ count: number }>;
  findFirst: (query: ReadShape & { orderBy?: OrderByClause | OrderByClause[]; where?: object }) => Promise<unknown>;
  findMany: (
    query: ReadShape & { orderBy?: OrderByClause | OrderByClause[]; take?: number; where?: object }
  ) => Promise<unknown[]>;
  findUnique: (query: ReadShape & { where: object }) => Promise<unknown>;
  rows: TRow[];
  update: (query: { data: object; where: object }) => Promise<unknown>;
  updateMany: (query: { data: object; where: object }) => Promise<{ count: number }>;
  upsert: (query: { create: object; update: object; where: object }) => Promise<unknown>;
};

/**
 * An in-memory stand-in for one Prisma model delegate, implementing only the query surface the
 * services actually use: equality/`in`/`startsWith`/date-range where-matching, nested relation conditions,
 * ordered `orderBy`, `select` projection, `include` attachment, and P2002 emulation on create.
 */
export function createModelTable<TRow extends object>(options: ModelTableOptions<TRow> = {}): ModelTable<TRow> {
  const rows: TRow[] = [];
  let sequence = 0;

  const toComparable = (value: unknown): number | string => {
    if (value instanceof Date) {
      return value.getTime();
    }
    return value as number | string;
  };

  const resolveField = (row: TRow, field: string): unknown => {
    if (field in row) {
      return (row as { [key: string]: unknown })[field];
    }
    return options.relations?.[field]?.(row);
  };

  const matchesCondition = (value: unknown, condition: unknown): boolean => {
    if (condition === null) {
      return value === null;
    }
    if (condition instanceof Date) {
      return value instanceof Date && value.getTime() === condition.getTime();
    }
    if (typeof condition === 'object') {
      const clauses = condition as { [operator: string]: unknown };
      if ('in' in clauses) {
        return (clauses.in as unknown[]).some((candidate) => matchesCondition(value, candidate));
      }
      if ('not' in clauses) {
        return !matchesCondition(value, clauses.not);
      }
      if ('startsWith' in clauses) {
        return typeof value === 'string' && value.startsWith(clauses.startsWith as string);
      }
      if ('gt' in clauses || 'gte' in clauses || 'lt' in clauses || 'lte' in clauses) {
        const actual = toComparable(value);
        if ('gt' in clauses && !(actual > toComparable(clauses.gt))) {
          return false;
        }
        if ('gte' in clauses && !(actual >= toComparable(clauses.gte))) {
          return false;
        }
        if ('lt' in clauses && !(actual < toComparable(clauses.lt))) {
          return false;
        }
        if ('lte' in clauses && !(actual <= toComparable(clauses.lte))) {
          return false;
        }
        return true;
      }
      if (value === null || value === undefined || typeof value !== 'object') {
        // a scalar met an object condition with no recognized operator: an unsupported Prisma
        // operator would otherwise silently match nothing and the test would pass for the wrong reason
        throw new Error(`unsupported where condition ${JSON.stringify(condition)} against a scalar value`);
      }
      return Object.entries(clauses).every(([field, nested]) => {
        return nested === undefined || matchesCondition((value as { [key: string]: unknown })[field], nested);
      });
    }
    return value === condition;
  };

  const matchesWhere = (row: TRow, where: object | undefined): boolean => {
    if (!where) {
      return true;
    }
    return Object.entries(where).every(
      ([field, condition]) => condition === undefined || matchesCondition(resolveField(row, field), condition)
    );
  };

  const sorted = (matching: TRow[], orderBy: OrderByClause | OrderByClause[] | undefined): TRow[] => {
    const clauses = [orderBy].flat().filter((clause) => clause !== undefined);
    if (clauses.length === 0) {
      return matching;
    }
    return matching.toSorted((left, right) => {
      for (const clause of clauses) {
        const [field, direction] = Object.entries(clause)[0]!;
        const leftValue = toComparable(resolveField(left, field));
        const rightValue = toComparable(resolveField(right, field));
        if (leftValue < rightValue) {
          return direction === 'asc' ? -1 : 1;
        }
        if (leftValue > rightValue) {
          return direction === 'asc' ? 1 : -1;
        }
      }
      return 0;
    });
  };

  const project = (target: unknown, fields: { [field: string]: boolean }): unknown => {
    if (target === null || target === undefined || typeof target !== 'object') {
      return target;
    }
    return Object.fromEntries(
      Object.entries(fields)
        .filter(([, wanted]) => wanted)
        .map(([field]) => [field, (target as { [key: string]: unknown })[field]])
    );
  };

  const decorate = (row: TRow, { include, select }: ReadShape): unknown => {
    if (select) {
      return Object.fromEntries(
        Object.entries(select)
          .filter(([, wanted]) => wanted)
          .map(([field]) => [field, resolveField(row, field)])
      );
    }
    const copy: { [key: string]: unknown } = {};
    Object.assign(copy, row);
    for (const [name, wanted] of Object.entries(include ?? {})) {
      if (!wanted) {
        continue;
      }
      const related = resolveField(row, name);
      copy[name] = typeof wanted === 'object' ? project(related, wanted.select) : related;
    }
    return copy;
  };

  const api: ModelTable<TRow> = {
    count: ({ where }) => Promise.resolve(rows.filter((row) => matchesWhere(row, where)).length),
    create: ({ data }) => {
      const provided = Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined));
      const row = { ...options.defaults?.(sequence++), ...provided } as TRow;
      for (const field of options.uniqueFields ?? []) {
        if (rows.some((existing) => matchesCondition(resolveField(existing, field), resolveField(row, field)))) {
          return Promise.reject(
            new Prisma.PrismaClientKnownRequestError('unique constraint violation', {
              clientVersion: '0',
              code: 'P2002'
            })
          );
        }
      }
      rows.push(row);
      return Promise.resolve({ ...row });
    },
    deleteMany: ({ where }) => {
      const doomed = rows.filter((row) => matchesWhere(row, where));
      for (const row of doomed) {
        rows.splice(rows.indexOf(row), 1);
      }
      return Promise.resolve({ count: doomed.length });
    },
    findFirst: ({ orderBy, where, ...shape }) => {
      const [first] = sorted(
        rows.filter((row) => matchesWhere(row, where)),
        orderBy
      );
      return Promise.resolve(first ? decorate(first, shape) : null);
    },
    findMany: ({ orderBy, take, where, ...shape }) => {
      return Promise.resolve(
        sorted(
          rows.filter((row) => matchesWhere(row, where)),
          orderBy
        )
          .slice(0, take)
          .map((row) => decorate(row, shape))
      );
    },
    findUnique: ({ where, ...shape }) => {
      const row = rows.find((candidate) => matchesWhere(candidate, where));
      return Promise.resolve(row ? decorate(row, shape) : null);
    },
    rows,
    update: ({ data, where }) => {
      const row = rows.find((candidate) => matchesWhere(candidate, where));
      if (!row) {
        return Promise.reject(new Error('no row matched the update'));
      }
      Object.assign(row, data);
      return Promise.resolve({ ...row });
    },
    updateMany: ({ data, where }) => {
      const matching = rows.filter((row) => matchesWhere(row, where));
      for (const row of matching) {
        Object.assign(row, data);
      }
      return Promise.resolve({ count: matching.length });
    },
    upsert: ({ create, update, where }) => {
      const row = rows.find((candidate) => matchesWhere(candidate, where));
      if (!row) {
        return api.create({ data: create });
      }
      Object.assign(row, update);
      return Promise.resolve({ ...row });
    }
  };
  return api;
}
