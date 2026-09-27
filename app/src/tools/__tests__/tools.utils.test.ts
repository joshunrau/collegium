import { Result } from '@collegium/core/utils';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { toToolSchema } from '../tools.utils.ts';

const schemaOf = (parameters: z.ZodObject) => {
  return toToolSchema('fixture__tool', {
    description: 'A fixture.',
    execute: () => Result.ok({ text: 'done' }),
    parameters
  }).parameters;
};

describe('toToolSchema', () => {
  it('should state an optional field’s bound in its description and send no maxLength (§7.2)', () => {
    const parameters = schemaOf(
      z.object({ note: z.string().min(1).max(4000).optional().describe('What this pass did') })
    );
    expect(parameters).toMatchObject({
      properties: { note: { description: 'What this pass did (at most 4,000 characters)', minLength: 1 } }
    });
    expect(JSON.stringify(parameters)).not.toContain('maxLength');
  });

  it('should state a nullable field’s bound once, on the description the field carries (§7.2)', () => {
    const parameters = schemaOf(z.object({ reason: z.string().max(640).nullable().describe('Why') }));
    expect(JSON.stringify(parameters).match(/at most 640 characters/g)).toHaveLength(1);
    expect(parameters).toMatchObject({ properties: { reason: { description: 'Why (at most 640 characters)' } } });
  });

  it('should state nested bounds and send no maxItems (§7.2)', () => {
    const parameters = schemaOf(
      z.object({
        find: z.array(z.string().max(200)).max(5).describe('Phrases'),
        rows: z.array(z.object({ name: z.string().max(200) }))
      })
    );
    expect(parameters).toMatchObject({
      properties: {
        find: { description: 'Phrases (at most 5 items)', items: { description: 'At most 200 characters' } },
        rows: { items: { properties: { name: { description: 'At most 200 characters' } } } }
      }
    });
    expect(JSON.stringify(parameters)).not.toMatch(/maxLength|maxItems/);
  });
});
