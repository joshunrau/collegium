import { toQualifiedName } from '@collegium/core/plugins';
import type { PluginContext } from '@collegium/core/plugins';
import type { Skill } from '@collegium/core/skills';
import type { Tool } from '@collegium/core/tools';

import type { LoadedPlugin } from './plugins.types.ts';
import type { PluginStorageService } from './storage/plugin-storage.service.ts';

export class PluginsRegistry {
  /** keyed by qualified `<plugin>__<skill>` name */
  readonly skills: ReadonlyMap<string, Skill>;
  readonly tools: readonly Tool.Any[];

  constructor(plugins: readonly LoadedPlugin[], storageService: Pick<PluginStorageService, 'collection'>) {
    this.tools = plugins.flatMap((plugin) => {
      const { collections = {}, name } = plugin.manifest;
      const context: PluginContext = {
        settings: plugin.settings,
        storage: Object.fromEntries(
          Object.entries(collections).map(([collection, schema]) => [
            collection,
            storageService.collection(name, collection, schema)
          ])
        )
      };
      return plugin.manifest.tools.map((PluginTool) => new PluginTool(context));
    });
    this.skills = new Map(
      plugins.flatMap((plugin) =>
        Object.entries(plugin.skills).map(
          ([name, skill]) => [toQualifiedName(plugin.manifest.name, name), skill] as const
        )
      )
    );
  }
}
