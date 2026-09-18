import { describe, expect, it } from 'vitest';

import { renderReference } from '../reference.utils.ts';

describe('renderReference', () => {
  it('should render the first eight characters of an id', () => {
    expect(renderReference('abcdefghijklmnop')).toBe('abcdefgh');
  });
});
