import { describe, expect, it } from 'vitest';

import { buildConfigJsonSchema } from '../utils.ts';

type SettingsRecord = { properties: { [key: string]: { required?: string[] } } };

describe('buildConfigJsonSchema', () => {
  const schema = buildConfigJsonSchema() as unknown as {
    properties: {
      agentDefaults: { properties: { toolSettings: SettingsRecord } };
      agents: {
        additionalProperties: { properties: { toolSettings: SettingsRecord } };
        propertyNames: { pattern: string };
      };
    };
  };

  it('should embed each framework settings schema with its top-level required stripped (§8)', () => {
    const settings = schema.properties.agents.additionalProperties.properties.toolSettings.properties;
    expect(Object.keys(settings)).toStrictEqual(['mail', 'memory']);
    expect(settings.mail?.required).toBeUndefined();
    expect(Object.keys(schema.properties.agentDefaults.properties.toolSettings.properties)).toStrictEqual([
      'mail',
      'memory'
    ]);
  });

  it('should state the agent key grammar as the record’s property names', () => {
    expect(schema.properties.agents.propertyNames.pattern).toBe('^[a-z][a-z0-9-]*$');
  });
});
