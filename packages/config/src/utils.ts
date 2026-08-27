import { GRANTABLE_TOOLSET_DEFS } from '@collegium/core/toolsets';
import type { ToolsetDef } from '@collegium/core/toolsets';
import { z } from 'zod';

import { $Config } from './schemas/config.resolution.ts';

type JsonSchema = { [key: string]: unknown };

function requireObject(value: unknown, where: string): JsonSchema {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`expected the generated schema to hold an object at ${where}`);
  }
  return value as JsonSchema;
}

/** the node at a dotted path beneath the root, each segment required to hold an object */
function requireNodeAt(root: JsonSchema, path: readonly string[]): JsonSchema {
  return path.reduce<JsonSchema>((node, segment, index) => {
    return requireObject(node[segment], `$.${path.slice(0, index + 1).join('.')}`);
  }, root);
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

/** where the two settings records sit in the generated schema: the defaults, and each agent's own beneath the record's value */
const SETTINGS_RECORD_PATHS = [
  ['properties', 'agentDefaults', 'properties', 'toolSettings'],
  ['properties', 'agents', 'additionalProperties', 'properties', 'toolSettings']
] as const;

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
  for (const path of SETTINGS_RECORD_PATHS) {
    requireNodeAt(root, path).properties = toSettingsProperties(toolsets);
  }
  return schema;
}

/** the artifact itself: $Config with every framework settings schema embedded — the build, the docs site and its endpoint all emit this */
export function buildConfigJsonSchema(): JsonSchema {
  return toConfigJsonSchema($Config, GRANTABLE_TOOLSET_DEFS);
}

export type { JsonSchema };
