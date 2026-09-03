import { describe, expectTypeOf, it } from 'vitest';

import { format } from '../string.utils.ts';

import type { Placeholders } from '../string.utils.ts';

const TEMPLATE = `Each turn has {budget} calls. Calls to {exempt} do not.`;

describe('format', () => {
  it('reads the required names off the template text', () => {
    expectTypeOf<Placeholders<typeof TEMPLATE>>().toEqualTypeOf<'budget' | 'exempt'>();
  });

  it('refuses a missing or unknown placeholder value', () => {
    // @ts-expect-error — `exempt` is missing
    format(TEMPLATE, { budget: 7 });
    // @ts-expect-error — `extra` is not a placeholder
    format(TEMPLATE, { budget: 7, exempt: 'a', extra: 'b' });
  });
});
