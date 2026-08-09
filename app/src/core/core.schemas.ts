import { isNumberLike, parseNumber } from '@collegium/core/utils';
import { toCamelCaseKeys } from 'es-toolkit';
import { isObjectLike } from 'es-toolkit/compat';
import { z } from 'zod';

import { LOG_LEVELS } from './core.constants.ts';

export const $$CamelCased = <TSchema extends z.ZodType>(schema: TSchema) => {
  return z.preprocess((arg) => {
    if (isObjectLike(arg)) {
      return toCamelCaseKeys(arg);
    }
    return arg;
  }, schema);
};

export const $$JSONEncoded = <TSchema extends z.ZodType>(schema: TSchema) => {
  return z
    .string()
    .transform((arg, ctx) => {
      try {
        return JSON.parse(arg) as unknown;
      } catch {
        ctx.addIssue('must be a JSON-encoded string');
        return z.NEVER;
      }
    })
    .pipe(schema);
};

export const $NumberLike: z.ZodType<number> = z.preprocess((arg) => {
  if (isNumberLike(arg)) {
    return parseNumber(arg);
  }
  return arg;
}, z.number());

export type $LogLevel = z.infer<typeof $LogLevel>;
export const $LogLevel = z.enum(LOG_LEVELS);
