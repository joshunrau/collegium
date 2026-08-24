import { toCamelCaseKeys } from 'es-toolkit';
import { isObjectLike } from 'es-toolkit/compat';
import { z } from 'zod';

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

/**
 * A channel's name in its URL, not its display name and not its id — the one handle for a channel
 * an operator can state before the channel exists. Mattermost's own rule for the field.
 */
export type $ChannelHandle = z.infer<typeof $ChannelHandle>;
export const $ChannelHandle = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]*$/)
  .max(64);
