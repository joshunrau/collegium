import { SKILL_GRANT_VALUES } from '@collegium/core/toolsets';
import { describe, expect, it } from 'vitest';

import { buildConfigJsonSchema } from '../utils.ts';

type SettingsRecord = { properties: { [key: string]: { required?: string[] } } };

type GrantItems = { anyOf?: { enum?: string[]; type?: string }[]; type: string };

describe('buildConfigJsonSchema', () => {
  const schema = buildConfigJsonSchema() as unknown as {
    properties: {
      agentDefaults: { properties: { toolSettings: SettingsRecord } };
      agents: {
        additionalProperties: {
          properties: { skills: { items: GrantItems }; tools: { items: GrantItems }; toolSettings: SettingsRecord };
        };
        propertyNames: { pattern: string };
      };
    };
  };

  it('should embed each framework settings schema with its top-level required stripped (§8)', () => {
    const settings = schema.properties.agents.additionalProperties.properties.toolSettings.properties;
    expect(Object.keys(settings)).toStrictEqual(['mail', 'memory', 'tasks', 'web']);
    expect(settings.mail?.required).toBeUndefined();
    expect(Object.keys(schema.properties.agentDefaults.properties.toolSettings.properties)).toStrictEqual([
      'mail',
      'memory',
      'tasks',
      'web'
    ]);
  });

  it('should state the agent key grammar as the record’s property names', () => {
    expect(schema.properties.agents.propertyNames.pattern).toBe('^[a-z][a-z0-9-]*$');
  });

  it('should offer every tool grant beside an open arm, so a plugin grant still validates', () => {
    const items = schema.properties.agents.additionalProperties.properties.tools.items;
    expect(items.type).toBe('string');
    expect(items.anyOf?.[0]?.enum).toContain('mail::send');
    expect(items.anyOf?.[0]?.enum).not.toContain('builtins');
    expect(items.anyOf?.[1]).toStrictEqual({ type: 'string' });
  });

  it('should offer the skill grants the framework ships, and none when it ships none', () => {
    const items = schema.properties.agents.additionalProperties.properties.skills.items;
    expect(items.anyOf?.[0]?.enum ?? []).toStrictEqual([...SKILL_GRANT_VALUES]);
  });
});
