import { assertType, describe, expectTypeOf, it } from 'vitest';

import { Result } from '../result.utils.ts';

type Failure = { kind: 'provider'; message: string } | { kind: 'transport'; status: number };

// declared rather than assigned, or the initializer narrows the union away and every assertion
// below passes vacuously against `never`
declare const result: Result<string, Failure>;

describe('Result', () => {
  it('accepts ok and err against a declared return type', () => {
    const fromOk = (): Result<string, Failure> => Result.ok('body');
    const fromErr = (): Result<string, Failure> => Result.err({ kind: 'transport', status: 500 });
    expectTypeOf(fromOk).returns.toEqualTypeOf<Result<string, Failure>>();
    expectTypeOf(fromErr).returns.toEqualTypeOf<Result<string, Failure>>();
  });

  it('narrows to the value on success and the error on failure', () => {
    if (result.success) {
      expectTypeOf(result.value).toEqualTypeOf<string>();
      expectTypeOf(result.error).toEqualTypeOf<undefined>();
    } else {
      expectTypeOf(result.error).toEqualTypeOf<Failure>();
      expectTypeOf(result.value).toEqualTypeOf<undefined>();
    }
  });

  it('forwards a failure into a result of a different value type', () => {
    if (!result.success) {
      assertType<Result<number, Failure>>(result);
    }
  });

  it('wraps a plain value returned from pipe', () => {
    expectTypeOf(Result.ok('1').pipe(Number)).toEqualTypeOf<Result<number, never>>();
  });

  it('flattens a result returned from pipe and unions the error types', () => {
    const piped = result.pipe((value) => (value.length === 0 ? Result.err('empty' as const) : Result.ok(value.length)));
    expectTypeOf(piped).toEqualTypeOf<Result<number, 'empty' | Failure>>();
  });

  it('keeps the error type and never widens the value when piping a failure', () => {
    const failure = Result.err<Failure>({ kind: 'transport', status: 500 });
    expectTypeOf(failure.pipe(() => 1)).toEqualTypeOf<Result<number, Failure>>();
  });

  it('types unwrap as the value on ok and as never on err', () => {
    expectTypeOf(Result.ok('body').unwrap()).toEqualTypeOf<string>();
    expectTypeOf(Result.err('failed').unwrap()).toEqualTypeOf<never>();
  });
});
