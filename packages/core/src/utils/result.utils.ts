/* eslint-disable @typescript-eslint/no-unsafe-return */

import { isPlainObject } from 'es-toolkit';

export namespace Result {
  const symbol = Symbol.for('collegium.result');

  type InferOkTypes<TResult> = TResult extends Ok<infer TValue, unknown> ? TValue : never;
  type InferErrTypes<TResult> = TResult extends Err<infer TError> ? TError : never;

  type InferPipeReturnType<TReturn, TError> = [TReturn] extends [infer TResult extends Result]
    ? Result<InferOkTypes<TResult>, InferErrTypes<TResult> | TError>
    : Result<TReturn, TError>;

  export interface Err<TError> {
    error: TError;
    pipe<TReturn>(fn: (value: never) => TReturn): InferPipeReturnType<TReturn, TError>;
    success: false;
    [symbol]: true;
    unwrap(): never;
    value?: never;
  }

  export interface Ok<TValue, TError> {
    error?: never;
    pipe<TReturn>(fn: (value: TValue) => TReturn): InferPipeReturnType<TReturn, TError>;
    success: true;
    [symbol]: true;
    unwrap(): TValue;
    value: TValue;
  }

  function isResult(value: unknown): value is Result {
    if (!isPlainObject(value)) {
      return false;
    }
    return value[symbol] === true;
  }

  export function err(): Err<void>;
  export function err<TError>(error: TError): Err<TError>;
  export function err(error?: unknown): Err<unknown> {
    return {
      error: error,
      pipe() {
        return err(this.error) as any;
      },
      success: false,
      [symbol]: true,
      unwrap(): never {
        throw this.error;
      }
    };
  }

  export function ok(): Ok<void, never>;
  export function ok<TValue>(value: TValue): Ok<TValue, never>;
  export function ok(value?: unknown): Ok<unknown, never> {
    return {
      pipe(fn) {
        const value = fn(this.value);
        if (isResult(value)) {
          return value as any;
        }
        return ok(value);
      },
      success: true,
      [symbol]: true,
      unwrap() {
        return this.value;
      },
      value
    };
  }
}

export type Result<TValue = unknown, TError = unknown> = Result.Err<TError> | Result.Ok<TValue, TError>;
