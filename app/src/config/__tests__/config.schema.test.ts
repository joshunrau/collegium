import * as fs from 'node:fs';
import * as path from 'node:path';

import { $Config, toConfigJsonSchema } from '@collegium/config';
import { describe, expect, it } from 'vitest';

import { GRANTABLE_TOOLSETS } from '@/tools/tools.toolsets.ts';

describe('config.schema.json', () => {
  it('should match the schema generated from $Config (run `pnpm build:schema` if stale)', () => {
    const checkedInPath = path.resolve(import.meta.dirname, '../../../config.schema.json');
    const checkedIn: unknown = JSON.parse(fs.readFileSync(checkedInPath, 'utf-8'));
    expect(checkedIn).toStrictEqual(toConfigJsonSchema($Config, GRANTABLE_TOOLSETS));
  });

  it('should embed each framework settings schema with its top-level required stripped (§8)', () => {
    const schema = toConfigJsonSchema($Config, GRANTABLE_TOOLSETS) as unknown as {
      properties: {
        agents: { items: { properties: { toolSettings: { properties: { [key: string]: { required?: string[] } } } } } };
      };
    };
    const settings = schema.properties.agents.items.properties.toolSettings.properties;
    expect(Object.keys(settings)).toStrictEqual(['mail', 'memory']);
    expect(settings.mail?.required).toBeUndefined();
  });
});
