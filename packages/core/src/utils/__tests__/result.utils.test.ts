import { describe, expect, it, vi } from 'vitest';

import { Result } from '../result.utils.ts';

describe('Result', () => {
  describe('ok', () => {
    it('carries the value and reports success', () => {
      expect(Result.ok('value')).toMatchObject({ success: true, value: 'value' });
    });

    it('returns the value from unwrap', () => {
      expect(Result.ok('value').unwrap()).toBe('value');
    });

    it('wraps a plain value returned from pipe', () => {
      expect(Result.ok('1').pipe(Number)).toMatchObject({ success: true, value: 1 });
    });

    it('flattens a result returned from pipe rather than nesting it', () => {
      const result = Result.ok(1).pipe((value) => Result.ok(value + 1));
      expect(result).toMatchObject({ success: true, value: 2 });
    });

    it('adopts a failure returned from pipe', () => {
      const result = Result.ok(0).pipe((value) => (value === 0 ? Result.err('must not be zero') : Result.ok(value)));
      expect(result).toMatchObject({ error: 'must not be zero', success: false });
    });

    it('pipes in sequence', () => {
      const result = Result.ok('1').pipe(Number).pipe(String);
      expect(result).toMatchObject({ success: true, value: '1' });
    });
  });

  describe('err', () => {
    it('carries the error and reports failure', () => {
      expect(Result.err('error')).toMatchObject({ error: 'error', success: false });
    });

    it('throws the error from unwrap', () => {
      expect(() => Result.err(new Error('failed')).unwrap()).toThrow('failed');
    });

    it('passes through pipe without calling the function', () => {
      const transform = vi.fn();
      const result = Result.err('error').pipe(transform);
      expect(result).toMatchObject({ error: 'error', success: false });
      expect(result.value).toBeUndefined();
      expect(transform).not.toHaveBeenCalled();
    });
  });
});
