import type { z } from 'zod';

import type { CollectionQuery } from './collection-query.types.ts';

/** what the store stamps on every record beside the declared fields; a schema may not declare any of these */
export type CollectionRecordStamp = {
  readonly createdAt: Date;
  readonly id: string;
  readonly updatedAt: Date;
};

export type CollectionRecord<TValue> = CollectionRecordStamp & TValue;

/**
 * A toolset-scoped handle over one declared storage collection. Every record is the schema's
 * output plus the stamp; `create` parses through the schema, so defaults apply, and mints a
 * cuid2 unless an id is given. Reads parse each stored value, so a row an older schema wrote
 * fails loudly rather than leaking a stale shape into the tool.
 */
export type ToolsetCollection<TSchema extends z.ZodObject> = {
  create(data: z.input<TSchema> & { readonly id?: string }): Promise<CollectionRecord<z.output<TSchema>>>;
  deleteById(id: string): Promise<boolean>;
  findById(id: string): Promise<CollectionRecord<z.output<TSchema>> | null>;
  /** without a query, every record in insertion order */
  findMany(
    query?: CollectionQuery<CollectionRecord<z.output<TSchema>>>
  ): Promise<CollectionRecord<z.output<TSchema>>[]>;
  /** the patch merged over the stored fields and the whole parsed again, so a patch cannot leave an invalid record */
  updateById(id: string, patch: Partial<z.input<TSchema>>): Promise<CollectionRecord<z.output<TSchema>> | null>;
};

export type AnyToolsetCollection = ToolsetCollection<z.ZodObject>;
