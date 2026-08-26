import type { $PluginToolset } from '@collegium/core/plugins';

/** one plugin's declared skill documents: where they sit, and the namespace qualifying them (§9) */
export type PluginSkillSource = {
  readonly directory: string;
  readonly names: readonly string[];
  readonly namespace: string;
};

export type LoadedPlugin = {
  readonly skillsDirectory: string;
  readonly toolset: $PluginToolset;
};
