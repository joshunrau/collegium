import { z } from 'zod';

import { isNumberLike, parseNumber } from '../utils.ts';
import { LOG_LEVELS } from './common.constants.ts';

export const $NumberLike: z.ZodType<number> = z.preprocess((arg) => {
  if (isNumberLike(arg)) {
    return parseNumber(arg);
  }
  return arg;
}, z.number());

export type $LogLevel = z.infer<typeof $LogLevel>;
export const $LogLevel = z.enum(LOG_LEVELS);
