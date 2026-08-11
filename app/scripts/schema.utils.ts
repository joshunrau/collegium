import { z } from 'zod';

/**
 * How config.schema.json is generated, stated once so the checked-in file and the test guarding it
 * cannot disagree about the options and report staleness that regenerating would not fix.
 *
 * The input side, because this schema answers for the file an operator writes: a field carrying a
 * default is one they may omit. The output side would demand every default be stated. It also drops
 * `additionalProperties: false`, which is honest — `$Config` is built from loose objects, so an
 * unknown key really is accepted and stripped rather than refused.
 */
export function toConfigJsonSchema(config: z.ZodType) {
  return z.toJSONSchema(config, { io: 'input', target: 'draft-7' });
}
