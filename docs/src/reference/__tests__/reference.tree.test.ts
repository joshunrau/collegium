import { describe, expect, it } from 'vitest';

import { buildFieldTree, isContainer } from '../reference.tree.ts';

import type { JsonSchemaNode } from '../reference.types.ts';

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
          tools: {
            description: 'Grants.',
            items: {
              description: 'One grant.',
              type: 'string',
              'x-table': { rows: [{ label: 'x', values: ['x::a'] }], title: 'Built in' }
            },
            type: 'array'
          },
          username: { description: 'The handle.', type: 'string' }
        },
        required: ['username'],
        type: 'object'
      },
      type: 'array'
    },
    members: {
      additionalProperties: {
        properties: { role: { description: 'What they do.', type: 'string' } },
        required: ['role'],
        type: 'object'
      },
      propertyNames: { description: 'A handle.', maxLength: 22, pattern: '^[a-z]+$', title: 'handle', type: 'string' },
      type: 'object'
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

describe('buildFieldTree', () => {
  const [agents, members, settings, verbose] = buildFieldTree(schema);
  const [model, tools, username] = agents?.children ?? [];

  it('should type and anchor the root rows in schema order', () => {
    expect(agents).toMatchObject({ id: 'agents', required: true, type: 'object[]' });
    expect(settings).toMatchObject({ defaultValue: undefined, id: 'settings', required: false, type: 'object' });
    expect(verbose).toMatchObject({ required: false, type: 'boolean | null' });
  });

  it('should list an object array by the fields of one item, anchored by dotted path', () => {
    expect(username).toMatchObject({
      description: 'The handle.',
      id: 'agents.username',
      required: true,
      type: 'string'
    });
  });

  it('should tab a discriminated union by its discriminant and keep the discriminant out of the rows', () => {
    expect(model).toMatchObject({ type: 'object', variantGroup: 'provider="x"|"y"' });
    expect(model?.variants.map((variant) => variant.label)).toEqual(['provider: "x"', 'provider: "y"']);
    expect(model?.variants[0]?.children).toMatchObject([{ id: undefined, name: 'name', type: '"a" | "b"' }]);
  });

  it('should fold an item description and its table into the array row', () => {
    expect(tools).toMatchObject({
      children: [],
      description: 'Grants.\n\nOne grant.',
      table: { rows: [{ label: 'x', values: ['x::a'] }], title: 'Built in' },
      type: 'string[]'
    });
  });

  it('should show defaults as JSON and close an open record with a trailing row', () => {
    expect(settings?.children).toMatchObject([
      { defaultValue: '10', id: 'settings.limit', name: 'limit' },
      { description: 'Further keys are accepted beyond those listed.', id: 'settings.*', name: '*', type: 'any' }
    ]);
  });

  it('should stand one row for any key of a record, named by the key schema’s title and linked through `*`', () => {
    const [entry] = members?.children ?? [];
    expect(entry).toMatchObject({
      description: 'A handle.\n\nKeys match `^[a-z]+$`, at most 22 characters.',
      id: 'members.*',
      name: '<handle>',
      type: 'object'
    });
    expect(entry?.children).toMatchObject([{ description: 'What they do.', id: 'members.*.role', name: 'role' }]);
  });

  it('should count only rows holding tabs or linkable rows as containers', () => {
    expect(isContainer(model!)).toBe(true);
    expect(isContainer(settings!)).toBe(true);
    expect(isContainer(tools!)).toBe(false);
  });
});
