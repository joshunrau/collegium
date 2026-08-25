import { describe, expect, it } from 'vitest';

import { createServiceToken } from '../token.utils.ts';

describe('createServiceToken', () => {
  it('mints a distinct symbol carrying the description', () => {
    const token = createServiceToken<{ run(): void }>('RUNNER');
    expect(typeof token).toBe('symbol');
    expect(token.description).toBe('RUNNER');
    expect(createServiceToken('RUNNER')).not.toBe(token);
  });
});
