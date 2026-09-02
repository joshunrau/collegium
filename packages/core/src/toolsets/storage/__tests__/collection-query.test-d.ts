import { expectTypeOf, test } from 'vitest';
import { z } from 'zod';

import type { CollectionWhere } from '../collection-query.types.ts';
import type { CollectionRecord, ToolsetCollection } from '../collection.types.ts';

const $Investigator = z.object({
  email: z.string().nullable(),
  fields: z.array(z.string()),
  hIndex: z.number().optional(),
  institution: z.object({ name: z.string() }),
  status: z.enum(['contacted', 'new']).default('new')
});

type Investigator = CollectionRecord<z.output<typeof $Investigator>>;

test('where offers the scalar fields and the id, each conditioned by its own type', () => {
  expectTypeOf<keyof CollectionWhere<Investigator>>().toEqualTypeOf<'email' | 'hIndex' | 'id' | 'status'>();
  expectTypeOf<CollectionWhere<Investigator>['status']>().toEqualTypeOf<
    'contacted' | 'new' | undefined | { readonly contains: string } | { readonly in: readonly ('contacted' | 'new')[] }
  >();
  expectTypeOf<CollectionWhere<Investigator>['hIndex']>().toEqualTypeOf<
    number | undefined | { readonly in: readonly number[] }
  >();
});

test('create takes the schema input with an optional id, and every read returns stamped records', () => {
  type Collection = ToolsetCollection<typeof $Investigator>;
  expectTypeOf($Investigator).toExtend<z.ZodObject>();
  expectTypeOf<Parameters<Collection['create']>[0]>().toEqualTypeOf<
    z.input<typeof $Investigator> & { readonly id?: string }
  >();
  expectTypeOf<Awaited<ReturnType<Collection['findMany']>>>().toEqualTypeOf<Investigator[]>();
  expectTypeOf<Parameters<Collection['updateById']>[1]>().toEqualTypeOf<Partial<z.input<typeof $Investigator>>>();
});
