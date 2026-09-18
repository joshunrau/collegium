import { describe, expect, it } from 'vitest';

import { CHARS_PER_TOKEN, estimateTokens } from '../token-estimate.utils.ts';

describe('estimateTokens', () => {
  it('should cost text by the character ratio and never cost anything zero', () => {
    expect(estimateTokens('x'.repeat(CHARS_PER_TOKEN * 10))).toBe(10);
    expect(estimateTokens('')).toBe(1);
  });
});
