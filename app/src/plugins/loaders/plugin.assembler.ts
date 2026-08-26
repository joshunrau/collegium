import { $PluginToolset } from '@collegium/core/plugins';
import { Result } from '@collegium/core/utils';
import { Injectable } from '@nestjs/common';

import type { LoadedPlugin, PluginLoadFailure, PluginSource } from '../plugins.types.ts';

@Injectable()
export class PluginAssembler {
  /** the plugin perimeter (§7): an evaluated default export becomes a toolset here or not at all */
  async assemble(
    source: PluginSource,
    defaultExport: unknown
  ): Promise<Result<LoadedPlugin, PluginLoadFailure.Assemble>> {
    const parsed = await $PluginToolset.safeParseAsync(defaultExport);
    if (!parsed.success) {
      return Result.err({ cause: parsed.error, kind: 'toolset-invalid' });
    }
    const toolset = parsed.data;
    if (toolset.name !== source.name) {
      return Result.err({ declared: toolset.name, expected: source.name, kind: 'name-mismatch' });
    }
    return Result.ok({ skillsDirectory: source.skillsDirectory, toolset });
  }
}
