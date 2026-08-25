import type { z } from 'zod';

import type { ToolDefinition, ToolTurnScope } from '../tools.ts';
import type { ServiceToken } from '../utils.ts';
import type { CORE_TOOLSET_DEFS, FRAMEWORK_TOOLSET_DEFS, GRANTABLE_TOOLSET_DEFS } from './toolsets.constants.ts';

/** `settings`, `storage`, and `turn` are the context's own keys, so a service may not claim them */
export type ServicesDeclaration = { readonly [key: string]: ServiceToken<unknown> } & {
  readonly settings?: never;
  readonly storage?: never;
  readonly turn?: never;
};

export type CollectionsDeclaration = { readonly [key: string]: z.ZodType };

export type ParametersDeclaration = { readonly [key: string]: z.ZodType };

export type EmptyDeclaration = {};

/** a toolset-scoped handle over one declared storage collection; rows are validated on write and parsed on read */
export type ToolsetCollection<TValue> = {
  delete(key: string): Promise<boolean>;
  get(key: string): Promise<null | TValue>;
  list(): Promise<{ key: string; value: TValue }[]>;
  put(key: string, value: TValue): Promise<void>;
};

/**
 * What `execute` receives, assembled from exactly what the toolset declared (§4): each service
 * under its own name, `settings` and `storage` only when declared, and always the turn. Reaching
 * anything undeclared is a compile error.
 */
export type ToolsetContext<
  TServices extends ServicesDeclaration = EmptyDeclaration,
  TSettings extends undefined | z.ZodType = undefined,
  TCollections extends CollectionsDeclaration = EmptyDeclaration
> = { readonly [K in keyof TServices]: TServices[K] extends ServiceToken<infer TInstance> ? TInstance : never } & {
  readonly turn: ToolTurnScope;
} & (keyof TCollections extends never
    ? unknown
    : { readonly storage: { readonly [K in keyof TCollections]: ToolsetCollection<z.infer<TCollections[K]>> } }) &
  (TSettings extends z.ZodType ? { readonly settings: z.infer<TSettings> } : unknown);

/** a toolset: a namespace and everything that belongs to it (§2); the tools record's keys are the tool names */
export type ToolsetDeclaration<
  TName extends string,
  TServices extends ServicesDeclaration,
  TSettings extends undefined | z.ZodType,
  TCollections extends CollectionsDeclaration,
  TParamsMap extends ParametersDeclaration
> = {
  readonly name: TName;
  readonly services?: TServices;
  readonly settings?: TSettings;
  /** shipped skill documents by bare dashed name, granted as `<namespace>::<skill>` (§9) */
  readonly skills?: readonly string[];
  readonly storage?: TCollections;
  readonly tools: {
    readonly [K in keyof TParamsMap]: ToolDefinition<ToolsetContext<TServices, TSettings, TCollections>, TParamsMap[K]>;
  };
};

/** the loose shapes the registry and executor consume, reached from any concrete declaration via method bivariance */
export type AnyTool = ToolDefinition<ToolsetContext<EmptyDeclaration, undefined, EmptyDeclaration>, z.ZodType>;

export type AnyToolset = {
  readonly name: string;
  readonly services?: { readonly [key: string]: ServiceToken<unknown> };
  readonly settings?: z.ZodType;
  readonly skills?: readonly string[];
  readonly storage?: CollectionsDeclaration;
  readonly tools: { readonly [key: string]: AnyTool };
};

/** the `'<namespace>::<tool>'` literal union of the given toolsets — how names survive into the type (§2); distributes over a union */
export type ToolRefsOf<TToolset extends AnyToolset> = TToolset extends AnyToolset
  ? `${TToolset['name']}::${Extract<keyof TToolset['tools'], string>}`
  : never;

/** a plugin's toolset: the same declaration, refused `services` and `budgetExempt` (§7) */
export type PluginToolsetDeclaration<
  TName extends string,
  TSettings extends undefined | z.ZodType,
  TCollections extends CollectionsDeclaration,
  TParamsMap extends ParametersDeclaration
> = {
  readonly name: TName;
  readonly settings?: TSettings;
  readonly skills?: readonly string[];
  readonly storage?: TCollections;
  readonly tools: {
    readonly [K in keyof TParamsMap]: Omit<
      ToolDefinition<ToolsetContext<EmptyDeclaration, TSettings, TCollections>, TParamsMap[K]>,
      'budgetExempt'
    >;
  };
};

/** the SDK's narrowed view of `defineToolset` — one runtime function under one name for both audiences (§7) */
export type DefinePluginToolset = <
  const TName extends string,
  TParamsMap extends ParametersDeclaration,
  TSettings extends undefined | z.ZodType = undefined,
  const TCollections extends CollectionsDeclaration = EmptyDeclaration
>(
  declaration: PluginToolsetDeclaration<TName, TSettings, TCollections, TParamsMap>
) => PluginToolsetDeclaration<TName, TSettings, TCollections, TParamsMap>;

/**
 * The inert half of a framework toolset (§2): its namespace, the names of its tools, and the
 * settings schema config supplies for it. Declared below the app as a plain `as const satisfies
 * ToolsetDef` object, so that config, the JSON Schema and the docs can name what an operator may
 * grant without loading a single tool body. The app realises it with `implementToolset`, which
 * holds the tool-name set equal at compile time and runs the declaration grammar over the whole.
 */
export type ToolsetDef<
  TName extends string = string,
  TTools extends readonly string[] = readonly string[],
  TSettings extends undefined | z.ZodType = undefined | z.ZodType
> = {
  readonly name: TName;
  readonly settings?: TSettings;
  /** shipped skill documents by bare dashed name, granted as `<namespace>::<skill>` (§9) */
  readonly skills?: readonly string[];
  readonly tools: TTools;
};

/** the `'<namespace>::<tool>'` literal union of the given defs; distributes over a union */
export type ToolRefsOfDef<TDef extends ToolsetDef> = TDef extends ToolsetDef
  ? `${TDef['name']}::${TDef['tools'][number]}`
  : never;

/**
 * What the app supplies to realise a def: the services and storage the tools reach, and one
 * definition per declared tool name — no more, no fewer. The record is mapped over its own keys so
 * each tool's parameters infer; the constraint demands every declared name, and a key the def does
 * not name is typed as the message that refuses it.
 */
export type ToolsetImplementation<
  TToolName extends string,
  TServices extends ServicesDeclaration,
  TSettings extends undefined | z.ZodType,
  TCollections extends CollectionsDeclaration,
  TParamsMap extends { readonly [K in TToolName]: z.ZodType }
> = {
  readonly services?: TServices;
  readonly storage?: TCollections;
  readonly tools: {
    readonly [K in keyof TParamsMap]: K extends TToolName
      ? ToolDefinition<ToolsetContext<TServices, TSettings, TCollections>, TParamsMap[K]>
      : 'is not a tool of this def';
  };
};

export type CoreToolsetName = (typeof CORE_TOOLSET_DEFS)[number]['name'];

export type FrameworkToolsetName = (typeof FRAMEWORK_TOOLSET_DEFS)[number]['name'];

export type GrantableToolsetDef = (typeof GRANTABLE_TOOLSET_DEFS)[number];

/** what `agents[].tools` may hold for the framework: a namespace, or one tool by its `ns::tool` ref (§8) */
export type ToolGrant = GrantableToolsetDef['name'] | ToolRefsOfDef<GrantableToolsetDef>;
