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

/**
 * A channel's name in its URL, not its display name and not its id — the one handle for a channel
 * an operator can state before the channel exists. Mattermost's own rule for the field.
 */
/** a file beneath `RESOURCES_ROOT`; a symlink can still lead out, so the reader confines what it resolves to */
export type $ResourcePath = z.infer<typeof $ResourcePath>;
export const $ResourcePath = z
  .string()
  .min(1)
  .refine((value) => !value.startsWith('/') && !value.split(/[/\\]/).includes('..'), {
    message: 'must be a path relative to RESOURCES_ROOT that does not leave it'
  });

export type $ChannelHandle = z.infer<typeof $ChannelHandle>;
export const $ChannelHandle = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]*$/)
  .max(64);
