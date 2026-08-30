import type { z } from 'zod';

type CollectionsDeclaration = { readonly [key: string]: z.ZodType };

/**
 * The config file's default export: the settings schema agents are configured by, and the storage
 * collections the plugin owns. Its generics are what carry the settings and storage types to every
 * tool, through `Register`.
 */
export type PluginConfig<
  TSettings extends undefined | z.ZodType = undefined | z.ZodType,
  TCollections extends CollectionsDeclaration = CollectionsDeclaration
> = {
  readonly settings: TSettings;
  readonly storage: TCollections;
};

/**
 * The augmentation point. `src/config.ts` declares its config here, and every tool file receives
 * the declared settings and storage types without importing the config:
 *
 * ```ts
 * declare module '@collegium/sdk' {
 *   interface Register { config: typeof config }
 * }
 * ```
 */
export interface Register {}

export type RegisteredConfig = Register extends { readonly config: infer TConfig extends PluginConfig }
  ? TConfig
  : PluginConfig;

export function defineConfig<
  TSettings extends undefined | z.ZodType = undefined,
  const TCollections extends CollectionsDeclaration = {}
>(config: { readonly settings?: TSettings; readonly storage?: TCollections }): PluginConfig<TSettings, TCollections> {
  return {
    settings: config.settings as TSettings,
    storage: config.storage ?? ({} as TCollections)
  };
}
