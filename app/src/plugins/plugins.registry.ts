import { renderQualifiedSkillName } from '@collegium/core/skills';
import type { Skill } from '@collegium/core/skills';
import type { AnyToolset } from '@collegium/core/tools';

import { FRAMEWORK_TOOLSETS } from '@/tools/tools.toolsets.ts';

import type { LoadedPlugin } from './plugins.types.ts';

export class PluginsRegistry {
  /** keyed by qualified `<namespace>::<skill>` name (§9) */
  readonly skills: ReadonlyMap<string, Skill>;
  readonly toolsets: readonly AnyToolset[];

  constructor(plugins: readonly LoadedPlugin[]) {
    const reserved = new Set<string>(FRAMEWORK_TOOLSETS.map((toolset) => toolset.name));
    for (const plugin of plugins) {
      if (reserved.has(plugin.toolset.name)) {
        throw new Error(`plugin namespace "${plugin.toolset.name}" is reserved by the framework (§1)`);
      }
    }
    this.toolsets = plugins.map((plugin) => plugin.toolset);
    this.skills = new Map(
      plugins.flatMap((plugin) =>
        Object.entries(plugin.skills).map(
          ([name, skill]) => [renderQualifiedSkillName(plugin.toolset.name, name), skill] as const
        )
      )
    );
  }
}
