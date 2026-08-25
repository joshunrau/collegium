import { GRANTABLE_TOOLSET_DEFS } from '@collegium/core/toolsets';
import type { ToolsetDef } from '@collegium/core/toolsets';
import { z } from 'zod';

import { $Config } from './schemas/config.schemas.ts';

type JsonSchema = { [key: string]: unknown };

function requireObject(value: unknown, where: string): JsonSchema {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`expected the generated schema to hold an object at ${where}`);
  }
  return value as JsonSchema;
}

/**
 * A settings record's per-namespace schemas, with the top-level `required` stripped: the shallow
 * merge (§8) makes top-level keys the merge unit, so each source may legitimately be partial —
 * the boot parse of the merged value is what enforces the whole.
 */
function toSettingsProperties(toolsets: readonly ToolsetDef[]): JsonSchema {
  return Object.fromEntries(
    toolsets.flatMap((toolset) => {
      if (!toolset.settings) {
        return [];
      }
      const { required: _required, ...schema } = z.toJSONSchema(toolset.settings, { io: 'input', target: 'draft-7' });
      return [[toolset.name, schema]];
    })
  );
}

function embedSettingsProperties(record: unknown, toolsets: readonly ToolsetDef[], where: string): void {
  const node = requireObject(record, where);
  node.properties = toSettingsProperties(toolsets);
}

/**
 * How config.schema.json is generated, stated once so the build artifact and the docs site's copy
 * cannot disagree about the options.
 *
 * The input side, because this schema answers for the file an operator writes: a field carrying a
 * default is one they may omit. The output side would demand every default be stated.
 *
 * The two settings records get each framework toolset's own settings schema embedded, so an editor
 * completes mail or memory settings; plugin namespaces stay open, validated at boot instead.
 */
export function toConfigJsonSchema(config: z.ZodType, toolsets: readonly ToolsetDef[]): JsonSchema {
  const schema = z.toJSONSchema(config, { io: 'input', target: 'draft-7' });
  const root = requireObject(schema, '$');
  const properties = requireObject(root.properties, '$.properties');
  const agents = requireObject(properties.agents, '$.properties.agents');
  const agentProperties = requireObject(
    requireObject(agents.items, '$.properties.agents.items').properties,
    '$.properties.agents.items.properties'
  );
  embedSettingsProperties(agentProperties.toolSettings, toolsets, '$.properties.agents.items.properties.toolSettings');
  const appProperties = requireObject(
    requireObject(properties.app, '$.properties.app').properties,
    '$.properties.app.properties'
  );
  embedSettingsProperties(
    appProperties.defaultToolSettings,
    toolsets,
    '$.properties.app.properties.defaultToolSettings'
  );
  return schema;
}

/** the artifact itself: $Config with every framework settings schema embedded — the build, the docs site and its endpoint all emit this */
export function buildConfigJsonSchema(): JsonSchema {
  return toConfigJsonSchema($Config, GRANTABLE_TOOLSET_DEFS);
}

export type { JsonSchema };
