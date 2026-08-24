import { z } from 'zod';

import { isNumberLike, parseNumber } from '../utils.ts';

export const $NumberLike: z.ZodType<number> = z.preprocess((arg) => {
  if (isNumberLike(arg)) {
    return parseNumber(arg);
  }
  return arg;
}, z.number());
