/** the JSON scalars a query may compare; an object, array, or date field is not queryable */
type Scalar = boolean | null | number | string;

/**
 * The top-level scalar fields of a record, each stripped of the undefined an optional field
 * carries. The intersection with the scalar union changes nothing for a concrete record and is what
 * lets the compiler see, over a generic one, that every condition is a scalar condition.
 */
type QueryableFields<TRecord> = {
  readonly [K in keyof TRecord as Exclude<TRecord[K], undefined> extends Scalar ? K : never]-?: Exclude<
    TRecord[K],
    undefined
  > &
    Scalar;
};

/** every stated condition of any typed query reads as one of these */
export type LooseCollectionWhere = { readonly [field: string]: CollectionFieldCondition<Scalar> | undefined };

export type CollectionScalar = Scalar;

/** one field's condition: equality, membership, or — on a string field — a case-insensitive substring */
export type CollectionFieldCondition<TField> =
  | ([Extract<TField, string>] extends [never] ? never : { readonly contains: string })
  | TField
  | { readonly in: readonly TField[] };

/** an AND over field conditions, keyed by the record's own scalar fields */
export type CollectionWhere<TRecord> = {
  readonly [K in keyof QueryableFields<TRecord>]?: CollectionFieldCondition<QueryableFields<TRecord>[K]>;
};

export type CollectionQuery<TRecord> = {
  readonly limit?: number;
  readonly where?: CollectionWhere<TRecord>;
};
