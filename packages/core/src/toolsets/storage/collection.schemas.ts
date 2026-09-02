import { z } from 'zod';

import type { CollectionRecordStamp } from './collection.types.ts';

const RESERVED_FIELDS: readonly (keyof CollectionRecordStamp)[] = ['createdAt', 'id', 'updatedAt'];

/** a collection's declared shape: an object schema that leaves the store's own stamp fields to the store */
export const $CollectionSchema = z
  .custom<z.ZodObject>((arg) => arg instanceof z.ZodObject, 'a storage collection must be an object schema')
  .refine(
    (schema) => RESERVED_FIELDS.every((field) => !(field in schema.shape)),
    `a storage collection may not declare ${RESERVED_FIELDS.map((field) => `"${field}"`).join(', ')}; the store stamps them`
  );
