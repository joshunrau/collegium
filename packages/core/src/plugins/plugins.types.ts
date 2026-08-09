import type { z } from 'zod';

import type { Tool } from '../tools.ts';
import type { PLUGIN_NAME_SEPARATOR } from './plugins.constants.ts';

export type PluginQualifiedName<
  TPluginName extends string,
  TCapabilityName extends string
> = `${TPluginName}${typeof PLUGIN_NAME_SEPARATOR}${TCapabilityName}`;

/** the declarative half of a plugin, stated once; tool context types and the manifest both derive from it */
export type PluginContract = {
  readonly collections?: { [key: string]: z.ZodType };
  readonly name: string;
  readonly settings?: z.ZodType;
};

export type PluginCollection<TValue> = {
  delete(key: string): Promise<boolean>;
  get(key: string): Promise<null | TValue>;
  list(): Promise<{ key: string; value: TValue }[]>;
  put(key: string, value: TValue): Promise<void>;
};

/**
 * The entire surface the framework offers a plugin at runtime, built once per plugin at boot.
 * Unparameterized it is the loose shape the framework assembles; parameterized by a contract it is
 * what a plugin tool reads through `this.context`.
 */
export type PluginContext<TContract extends PluginContract = PluginContract> = {
  readonly settings:
    (undefined extends TContract['settings'] ? undefined : never) | z.infer<NonNullable<TContract['settings']>>;
  readonly storage: {
    readonly [TCollection in keyof NonNullable<TContract['collections']>]: PluginCollection<
      z.infer<NonNullable<TContract['collections']>[TCollection]>
    >;
  };
};

/** what a plugin manifest carries: the framework constructs each tool with the plugin's context */
export type PluginToolConstructor = {
  prototype: Tool.Any;
  new (context: PluginContext): Tool.Any;
};
