/** the JSON scalars a query may compare; an object or array field is not queryable */
type Scalar = boolean | null | number | string;

/** the top-level scalar fields of a value; a loose value is queryable on any field, a non-object on none */
type QueryableFields<TValue> = unknown extends TValue
  ? { readonly [field: string]: Scalar }
  : TValue extends readonly unknown[]
    ? {}
    : TValue extends object
      ? {
          readonly [K in keyof TValue as Exclude<TValue[K], undefined> extends Scalar ? K : never]-?: Exclude<
            TValue[K],
            undefined
          >;
        }
      : {};

export type CollectionScalar = Scalar;

/** one field's condition: equality, membership, or — on a string field — a case-insensitive substring */
export type CollectionFieldCondition<TField> =
  | ([Extract<TField, string>] extends [never] ? never : { readonly contains: string })
  | TField
  | { readonly in: readonly TField[] };

/** an AND over field conditions, keyed by the value's own scalar fields */
export type CollectionWhere<TValue> = {
  readonly [K in keyof QueryableFields<TValue>]?: CollectionFieldCondition<QueryableFields<TValue>[K]>;
};

export type CollectionQuery<TValue> = {
  readonly limit?: number;
  readonly where?: CollectionWhere<TValue>;
};
