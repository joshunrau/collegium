import { describe, expect, it } from 'vitest';

import { errorToJSON, toErrorMessage } from '../error.utils.ts';

describe('errorToJSON', () => {
  const cause = new Error('Something else went wrong');
  const error = new Error('Something went wrong', { cause });
  error.name = 'CustomError';

  it('should return the expected output', () => {
    expect(errorToJSON(error)).toStrictEqual({
      cause: {
        message: 'Something else went wrong',
        name: 'Error',
        stack: expect.toSatisfy((arg) => Array.isArray(arg) && arg.every((item) => typeof item === 'string'))
      },
      message: 'Something went wrong',
      name: 'CustomError',
      stack: expect.toSatisfy((arg) => Array.isArray(arg) && arg.every((item) => typeof item === 'string'))
    });
  });
  it('should not include the stack, if set in the options', () => {
    expect(errorToJSON(error, { includeStack: false })).toStrictEqual({
      cause: {
        message: 'Something else went wrong',
        name: 'Error'
      },
      message: 'Something went wrong',
      name: 'CustomError'
    });
  });
  it('should pass through a non-error-like cause as-is', () => {
    const errorWithNonErrorCause = new Error('Something went wrong', { cause: 'a plain string cause' });
    expect(errorToJSON(errorWithNonErrorCause, { includeStack: false })).toStrictEqual({
      cause: 'a plain string cause',
      message: 'Something went wrong',
      name: 'Error'
    });
  });
  it('should return an empty stack when the error has no stack', () => {
    const errorWithoutStack = new Error('Something went wrong');
    delete errorWithoutStack.stack;
    expect(errorToJSON(errorWithoutStack)).toStrictEqual({
      message: 'Something went wrong',
      name: 'Error',
      stack: ['']
    });
  });
});

describe('toErrorMessage', () => {
  it('should return the message of an error', () => {
    expect(toErrorMessage(new Error('Something went wrong'))).toBe('Something went wrong');
  });

  it('should stringify a thrown non-error', () => {
    expect(toErrorMessage('Something went wrong')).toBe('Something went wrong');
  });
});
