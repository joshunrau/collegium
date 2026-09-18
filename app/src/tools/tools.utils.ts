import type { AnyTool, AnyToolset, AnyToolsetCollection, AnyToolsetCollectionReader } from '@collegium/core/toolsets';
import type { ServiceToken } from '@collegium/core/utils';
import { z } from 'zod';

import type { ToolSchema } from '@/core/core.types.ts';

import type { RegisteredToolset } from './tools.registry.ts';

/** a new object, never the collection itself: that type-checks as a reader but still carries the writes at runtime (§3.4) */
function toCollectionReader(collection: AnyToolsetCollection): AnyToolsetCollectionReader {
  return {
    findById: (id) => collection.findById(id),
    findFirst: (query) => collection.findFirst(query),
    findMany: (query) => collection.findMany(query)
  };
}

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
  buildCollection: (namespace: string, collection: string, schema: z.ZodObject) => AnyToolsetCollection
): RegisteredToolset {
  const storage = Object.fromEntries(
    Object.entries(declaration.storage ?? {}).map(([name, schema]) => [
      name,
      buildCollection(declaration.name, name, schema)
    ])
  );
  return {
    declaration,
    services: Object.fromEntries(
      Object.entries(declaration.services ?? {}).map(([name, token]) => [name, resolveService(token)])
    ),
    storage,
    storageReaders: Object.fromEntries(
      Object.entries(storage).map(([name, collection]) => [name, toCollectionReader(collection)])
    )
  };
}
