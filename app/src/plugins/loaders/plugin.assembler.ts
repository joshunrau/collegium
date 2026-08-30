import { $PluginConfig, $PluginTool, toFrameworkTool } from '@collegium/core/plugins';
import type { AnyTool } from '@collegium/core/toolsets';
import { Result } from '@collegium/core/utils';
import { Injectable } from '@nestjs/common';

import { CONFIG_FILE } from '../plugins.constants.ts';

import type { LoadedPlugin, PluginLoadFailure, PluginSource } from '../plugins.types.ts';

/** the shape the synthetic entry exports; a mismatch is the framework's own bug, so it throws */
function toEntryModules(defaultExport: unknown): {
  config: { [key: string]: unknown };
  tools: { [name: string]: { [key: string]: unknown } };
} {
  if (typeof defaultExport !== 'object' || defaultExport === null) {
    throw new Error('the synthetic entry did not export its module record');
  }
  return defaultExport as ReturnType<typeof toEntryModules>;
}

@Injectable()
export class PluginAssembler {
  async assemble(
    source: PluginSource,
    defaultExport: unknown
  ): Promise<Result<LoadedPlugin, PluginLoadFailure.Assemble>> {
    const entry = toEntryModules(defaultExport);
    if (!('default' in entry.config)) {
      return Result.err({ file: CONFIG_FILE, kind: 'default-export-missing' });
    }
    const config = await $PluginConfig.safeParseAsync(entry.config.default);
    if (!config.success) {
      return Result.err({ cause: config.error, kind: 'config-invalid' });
    }

    const tools: { [name: string]: AnyTool } = {};
    for (const { file, name } of source.toolFiles) {
      const module = entry.tools[name] ?? {};
      if (!('default' in module)) {
        return Result.err({ file, kind: 'default-export-missing' });
      }
      const tool = await $PluginTool.safeParseAsync(module.default);
      if (!tool.success) {
        return Result.err({ cause: tool.error, file, kind: 'tool-invalid' });
      }
      tools[name] = toFrameworkTool(tool.data);
    }

    return Result.ok({
      skillsDirectory: source.skillsDirectory,
      toolset: {
        name: source.name,
        settings: config.data.settings,
        skills: source.skillNames,
        storage: config.data.storage ?? {},
        tools
      }
    });
  }
}
