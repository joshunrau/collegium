import type { z } from 'zod';

import { assertSkillName } from '../skills.ts';
import { assertToolSegment, assertWireNameWithinLimit } from '../tools.ts';
import { $CollectionSchema } from './storage/collection.schemas.ts';

import type {
  CollectionsDeclaration,
  EmptyDeclaration,
  ParametersDeclaration,
  ServicesDeclaration,
  ToolsetDeclaration,
  ToolsetDef,
  ToolsetImplementation
} from './toolsets.types.ts';

/**
 * The single declaration function, framework and plugin alike (§7). Purely a perimeter for the
 * grammar the type system cannot state; the declaration itself is inert data, returned as given.
 */
export function defineToolset<
  const TName extends string,
  TParamsMap extends ParametersDeclaration,
  const TServices extends ServicesDeclaration = EmptyDeclaration,
  TSettings extends undefined | z.ZodType = undefined,
  const TCollections extends CollectionsDeclaration = EmptyDeclaration
>(
  declaration: ToolsetDeclaration<TName, TServices, TSettings, TCollections, TParamsMap>
): ToolsetDeclaration<TName, TServices, TSettings, TCollections, TParamsMap> {
  assertToolSegment(declaration.name, 'toolset namespace');
  for (const toolName of Object.keys(declaration.tools)) {
    assertToolSegment(toolName, 'tool name');
    assertWireNameWithinLimit([declaration.name, toolName]);
  }
  for (const [collectionName, schema] of Object.entries(declaration.storage ?? {})) {
    assertToolSegment(collectionName, 'storage collection name');
    $CollectionSchema.parse(schema);
  }
  for (const skillName of declaration.skills ?? []) {
    assertSkillName(skillName);
  }
  return declaration;
}

/** the def and its implementation joined into the declaration the registry and executor consume */
export function implementToolset<
  TName extends string,
  TTools extends readonly string[],
  TParamsMap extends { readonly [K in TTools[number]]: z.ZodType },
  TSettings extends undefined | z.ZodType = undefined,
  const TServices extends ServicesDeclaration = EmptyDeclaration,
  const TCollections extends CollectionsDeclaration = EmptyDeclaration
>(
  def: ToolsetDef<TName, TTools, TSettings>,
  implementation: ToolsetImplementation<TTools[number], TServices, TSettings, TCollections, TParamsMap>
): ToolsetDeclaration<TName, TServices, TSettings, TCollections, TParamsMap> {
  // the conditional over each key settled at the call site, where a key outside the def is refused;
  // in the generic body the compiler cannot collapse it, so the record is stated as what it is
  const tools = implementation.tools as ToolsetDeclaration<
    TName,
    TServices,
    TSettings,
    TCollections,
    TParamsMap
  >['tools'];
  return defineToolset<TName, TParamsMap, TServices, TSettings, TCollections>({
    name: def.name,
    services: implementation.services,
    settings: def.settings,
    skills: def.skills,
    storage: implementation.storage,
    tools
  });
}
