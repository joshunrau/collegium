import { expectTypeOf, test } from 'vitest';

import type { CollectionQuery, CollectionWhere } from '../collection-query.types.ts';

type Investigator = {
  email: null | string;
  fields: string[];
  hIndex?: number;
  institution: { name: string };
  status: 'contacted' | 'new';
};

test('where offers the scalar fields, each conditioned by its own type', () => {
  expectTypeOf<keyof CollectionWhere<Investigator>>().toEqualTypeOf<'email' | 'hIndex' | 'status'>();
  expectTypeOf<CollectionWhere<Investigator>['status']>().toEqualTypeOf<
    'contacted' | 'new' | undefined | { readonly contains: string } | { readonly in: readonly ('contacted' | 'new')[] }
  >();
  expectTypeOf<CollectionWhere<Investigator>['hIndex']>().toEqualTypeOf<
    number | undefined | { readonly in: readonly number[] }
  >();
});

test('a non-object collection has no queryable fields', () => {
  expectTypeOf<keyof CollectionWhere<string>>().toEqualTypeOf<never>();
  expectTypeOf<keyof CollectionWhere<string[]>>().toEqualTypeOf<never>();
});

test('a typed query is accepted where the loose query is consumed', () => {
  expectTypeOf<CollectionQuery<Investigator>>().toExtend<CollectionQuery<unknown>>();
});
