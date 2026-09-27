import type { AnyTool, AnyToolset, AnyToolsetCollection, AnyToolsetCollectionReader } from '@collegium/core/toolsets';
import type { ServiceToken } from '@collegium/core/utils';
import { z } from 'zod';

import type { ToolSchema } from '@/core/core.types.ts';

import { renderStatedSizeBound } from './tools.renderer.ts';

import type { RegisteredToolset } from './tools.registry.ts';

type JSONSchemaNode = z.core.JSONSchema.JSONSchema;

const SIZE_KEYWORDS = [
  ['maxLength', 'characters'],
  ['maxItems', 'items']
] as const;

/** a new object, never the collection itself: that type-checks as a reader but still carries the writes at runtime (§3.4) */
function toCollectionReader(collection: AnyToolsetCollection): AnyToolsetCollectionReader {
  return {
    findById: (id) => collection.findById(id),
    findFirst: (query) => collection.findFirst(query),
    findMany: (query) => collection.findMany(query)
  };
}

function withStatement(description: string | undefined, statement: string): string {
  if (description === undefined) {
    return `${statement.charAt(0).toUpperCase()}${statement.slice(1)}`;
  }
  return description.toLowerCase().includes(statement) ? description : `${description} (${statement})`;
}

function subschemasOf(node: JSONSchemaNode): JSONSchemaNode[] {
  return [
    ...Object.values(node.properties ?? {}),
    ...[node.items ?? []].flat(),
    ...(node.prefixItems ?? []),
    node.additionalProperties,
    ...Object.values(node.$defs ?? {})
  ].filter((subschema) => typeof subschema === 'object');
}

/**
 * §7.2 — a size bound leaves the wire for the description the model reads for its parameter: a
 * nullable's or a union's branch states its bound on the parent unless it carries a description itself.
 */
function restateSizeBounds(node: JSONSchemaNode, carrier: JSONSchemaNode = node): void {
  for (const [keyword, unit] of SIZE_KEYWORDS) {
    const bound = node[keyword];
    if (bound === undefined) {
      continue;
    }
    delete node[keyword];
    carrier.description = withStatement(carrier.description, renderStatedSizeBound(bound, unit));
  }
  for (const branch of [...(node.anyOf ?? []), ...(node.oneOf ?? []), ...(node.allOf ?? [])]) {
    restateSizeBounds(branch, branch.description === undefined ? carrier : branch);
  }
  for (const subschema of subschemasOf(node)) {
    restateSizeBounds(subschema);
  }
}

/** the definition in the shape a provider expects: the wire name, and the parameter schema converted exactly once (§3.4) */
export function toToolSchema(wireName: string, definition: AnyTool): ToolSchema {
  const parameters = z.toJSONSchema(definition.parameters);
  restateSizeBounds(parameters);
  return { description: definition.description, name: wireName, parameters };
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
