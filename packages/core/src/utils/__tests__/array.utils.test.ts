import { describe, expect, it } from 'vitest';

import { isUnique } from '../array.utils.ts';

describe('isUnique', () => {
  it('should return true for a unique array', () => {
    expect(isUnique([1, 2, 3])).toBe(true);
  });
  it('should return true for an empty array', () => {
    expect(isUnique([])).toBe(true);
  });
  it('should return false for an array with duplicate values', () => {
    expect(isUnique([1, 2, 2])).toBe(false);
  });
});
