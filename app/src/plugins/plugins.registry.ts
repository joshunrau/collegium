import type { AnyToolset } from '@collegium/core/toolsets';

import { FRAMEWORK_TOOLSETS } from '@/tools/tools.toolsets.ts';

import type { LoadedPlugin, PluginSkillSource } from './plugins.types.ts';

export class PluginsRegistry {
  /** what the skills module reads at boot; the documents themselves are never this module's (§9) */
  readonly skillSources: readonly PluginSkillSource[];
  readonly toolsets: readonly AnyToolset[];

  constructor(plugins: readonly LoadedPlugin[]) {
    const reserved = new Set<string>(FRAMEWORK_TOOLSETS.map((toolset) => toolset.name));
    for (const plugin of plugins) {
      if (reserved.has(plugin.toolset.name)) {
        throw new Error(`plugin namespace "${plugin.toolset.name}" is reserved by the framework (§1)`);
      }
    }
    this.toolsets = plugins.map((plugin) => plugin.toolset);
    this.skillSources = plugins
      .filter((plugin) => plugin.toolset.skills.length > 0)
      .map((plugin) => ({
        directory: plugin.skillsDirectory,
        names: plugin.toolset.skills,
        namespace: plugin.toolset.name
      }));
  }
}
