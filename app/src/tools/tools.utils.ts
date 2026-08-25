import type { AnyTool, AnyToolset, ToolsetCollection } from '@collegium/core/toolsets';
import type { ServiceToken } from '@collegium/core/utils';
import { z } from 'zod';

import type { ToolSchema } from '@/core/core.types.ts';

import type { RegisteredToolset } from './tools.registry.ts';

/** the definition in the shape a provider expects: the wire name, and the parameter schema converted exactly once (§3.4) */
export function toToolSchema(wireName: string, definition: AnyTool): ToolSchema {
  return {
    description: definition.description,
    name: wireName,
    parameters: z.toJSONSchema(definition.parameters)
  };
}

/** the declared context parts made real, once at boot (§4): services by token, collections scoped to the namespace */
export function registerToolset(
  declaration: AnyToolset,
  resolveService: (token: ServiceToken<unknown>) => unknown,
  buildCollection: (namespace: string, collection: string, schema: z.ZodType) => ToolsetCollection<unknown>
): RegisteredToolset {
  return {
    declaration,
    services: Object.fromEntries(
      Object.entries(declaration.services ?? {}).map(([name, token]) => [name, resolveService(token)])
    ),
    storage: Object.fromEntries(
      Object.entries(declaration.storage ?? {}).map(([name, schema]) => [
        name,
        buildCollection(declaration.name, name, schema)
      ])
    )
  };
}
