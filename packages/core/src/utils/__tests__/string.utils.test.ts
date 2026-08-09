import { describe, expect, it } from 'vitest';

import { removeTrailingSlash, uncapitalize } from '../string.utils.ts';

describe('removeTrailingSlash', () => {
  it('should remove a trailing slash, if one exists', () => {
    expect(removeTrailingSlash('http://example.com/')).toBe('http://example.com');
  });
  it('should return the input string, if no trailing slash exists', () => {
    expect(removeTrailingSlash('http://example.com')).toBe('http://example.com');
  });
});

describe('uncapitalize', () => {
  it('should convert the first letter of the string to a lowercase letter', () => {
    expect(uncapitalize('Foo')).toBe('foo');
    expect(uncapitalize('foo')).toBe('foo');
    expect(uncapitalize('Foo bar')).toBe('foo bar');
  });
});
