import type { Tool } from '@collegium/core/tools';
import { z } from 'zod';

import type { ToolSchema } from '@/core/core.types.ts';

type JsonSchema = { [key: string]: unknown };

function isObjectSchema(value: unknown): boolean {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === 'object';
}

/**
 * A Zod discriminated union converts to a root `oneOf` carrying no root `type`, which providers
 * reject outright — DeepSeek answers 400 with `schema must be a JSON Schema of 'type: "object"',
 * got 'type: null'`, and the request never reaches the model. So the root is given the
 * `type: "object"` every variant already declares, and `oneOf` becomes the equivalent but
 * wider-supported `anyOf`: the discriminator keeps the variants mutually exclusive, so nothing is
 * loosened, and each variant keeps its own `required`, so the schema still states which argument
 * each action needs.
 */
function toObjectRootedSchema(schema: JsonSchema): JsonSchema {
  const { oneOf, ...rest } = schema;
  if (!Array.isArray(oneOf) || !oneOf.every(isObjectSchema)) {
    return schema;
  }
  return { ...rest, anyOf: oneOf, type: 'object' };
}

/** the definition in the shape a provider expects, its parameter schema converted exactly once (§3.4) */
export function toToolSchema(definition: Tool.Any): ToolSchema {
  return {
    description: definition.description,
    name: definition.name,
    parameters: toObjectRootedSchema(z.toJSONSchema(definition.parameters))
  };
}
