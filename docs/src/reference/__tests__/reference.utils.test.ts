import { describe, expect, it } from 'vitest';

import { renderJsonSchemaMarkdown } from '../reference.utils.ts';

import type { JsonSchemaNode } from '../reference.utils.ts';

const schema: JsonSchemaNode = {
  properties: {
    agents: {
      description: 'Who runs here.',
      items: {
        properties: {
          model: {
            oneOf: [
              {
                properties: { name: { enum: ['a', 'b'] }, provider: { const: 'x' } },
                required: ['name', 'provider'],
                type: 'object'
              },
              { properties: { provider: { const: 'y' } }, type: 'object' }
            ]
          },
          tools: { description: 'Grants.', items: { description: 'One | grant.', type: 'string' }, type: 'array' },
          username: { description: 'The handle.', type: 'string' }
        },
        required: ['username'],
        type: 'object'
      },
      type: 'array'
    },
    settings: {
      additionalProperties: {},
      properties: { limit: { default: 10, description: 'A cap.', type: 'integer' } },
      type: 'object'
    },
    verbose: { type: ['boolean', 'null'] }
  },
  required: ['agents'],
  type: 'object'
};

describe('renderJsonSchemaMarkdown', () => {
  const markdown = renderJsonSchemaMarkdown(schema);

  it('should table the root fields with their type, default and requirement', () => {
    expect(markdown).toContain('| `agents` | array of object | _required_ | Who runs here. |');
    expect(markdown).toContain('| `verbose` | boolean \\| null |  |  |');
  });

  it('should head each structured field by its dotted path, arrays with []', () => {
    expect(markdown).toContain('## agents[]');
    expect(markdown).toContain('| `username` | string | _required_ | The handle. |');
  });

  it('should title union variants by their discriminant', () => {
    expect(markdown).toContain('### agents[].model — `provider: "x"`');
    expect(markdown).toContain('### agents[].model — `provider: "y"`');
    expect(markdown).toContain('| `name` | `"a"` \\| `"b"` | _required_ |  |');
  });

  it('should fold an item description into its array row and escape pipes', () => {
    expect(markdown).toContain('| `tools` | array of string |  | Grants. Each item: One \\| grant. |');
  });

  it('should show defaults and note open records', () => {
    expect(markdown).toContain('| `limit` | integer | `10` | A cap. |');
    expect(markdown).toContain('Further keys are accepted here beyond those listed.');
  });
});
