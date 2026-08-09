import { describe, expect, it } from 'vitest';

import { isNumberLike, parseNumber } from '../number.utils.ts';

const NUMBER_LIKE_VALUES = [
  5e3,
  0xff,
  -0.1,
  -0,
  0.0,
  +0,
  3.14,
  '5e3',
  '5e+3',
  '-0.1',
  '-0',
  '0.0',
  '+0',
  '3.14',
  '1.',
  '.1',
  Number.MAX_VALUE,
  Number.MIN_VALUE,
  Infinity,
  -Infinity,
  'Infinity',
  '  +Infinity',
  '  -Infinity  '
];

const NON_NUMBER_LIKE_VALUES = [
  '1..',
  '--5',
  'A5',
  '5A',
  NaN,
  null,
  undefined,
  '',
  '   ',
  'foo',
  [1],
  {},
  'NaN',
  'infinity',
  '--Infinity',
  '++Infinity'
];

describe('isNumberLike', () => {
  it('should return true for number-like values', () => {
    NUMBER_LIKE_VALUES.forEach((value) => {
      expect(isNumberLike(value)).toBe(true);
    });
  });
  it('should return false for non-number-like values', () => {
    NON_NUMBER_LIKE_VALUES.forEach((value) => {
      expect(isNumberLike(value)).toBe(false);
    });
  });
});

describe('parseNumber', () => {
  it('should parse numbers', () => {
    NUMBER_LIKE_VALUES.forEach((value) => {
      expect(Number.isNaN(parseNumber(value))).toBe(false);
    });
  });
  it('should return NaN for non-numbers', () => {
    NON_NUMBER_LIKE_VALUES.forEach((value) => {
      expect(Number.isNaN(parseNumber(value))).toBe(true);
    });
  });
});
