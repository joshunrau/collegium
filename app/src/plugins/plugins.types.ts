import type { $PluginToolset } from '@collegium/core/plugins';
import type { Skill } from '@collegium/core/skills';

export type LoadedPlugin = {
  /** keyed by bare skill name; qualified as `<namespace>::<skill>` at registration (§9) */
  readonly skills: Readonly<{ [key: string]: Skill }>;
  readonly toolset: $PluginToolset;
};
