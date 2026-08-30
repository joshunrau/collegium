import { z } from 'zod';

/** USER TYPES */

interface Config {}

type ConfigDef<TSettings extends undefined | z.ZodType = any> = {
  settings: TSettings;
};

type InferConfig<TDef extends ConfigDef> = {
  settings: z.infer<TDef['settings']>;
};

type Settings = Config extends { settings: infer TSettings } ? TSettings : never;

type Tool = {
  execute: (args: any, context: { settings: Settings }) => any;
};

export function defineConfig<TSettings extends undefined | z.ZodType>(
  fn: (context: { z: typeof z }) => ConfigDef<TSettings>
) {
  return fn({ z });
}

export function defineTool(tool: Tool) {
  return tool;
}

export function defineToolset2(toolset: { tools: Tool[] }) {
  return toolset;
}

export type { Config, InferConfig };
