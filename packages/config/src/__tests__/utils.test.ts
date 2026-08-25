import { describe, expect, it } from 'vitest';

import { buildConfigJsonSchema } from '../utils.ts';

describe('buildConfigJsonSchema', () => {
  it('should embed each framework settings schema with its top-level required stripped (§8)', () => {
    const schema = buildConfigJsonSchema() as unknown as {
      properties: {
        agents: { items: { properties: { toolSettings: { properties: { [key: string]: { required?: string[] } } } } } };
        app: { properties: { defaultToolSettings: { properties: { [key: string]: unknown } } } };
      };
    };
    const settings = schema.properties.agents.items.properties.toolSettings.properties;
    expect(Object.keys(settings)).toStrictEqual(['mail', 'memory']);
    expect(settings.mail?.required).toBeUndefined();
    expect(Object.keys(schema.properties.app.properties.defaultToolSettings.properties)).toStrictEqual([
      'mail',
      'memory'
    ]);
  });
});
