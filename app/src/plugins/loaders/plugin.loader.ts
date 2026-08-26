import type { $PluginName } from '@collegium/config';
import type { Result } from '@collegium/core/utils';
import { Injectable } from '@nestjs/common';

import { PluginAssembler } from './plugin.assembler.ts';
import { PluginCompiler } from './plugin.compiler.ts';
import { PluginLocator } from './plugin.locator.ts';

import type { LoadedPlugin, PluginLoadFailure } from '../plugins.types.ts';

@Injectable()
export class PluginLoader {
  constructor(
    private readonly assembler: PluginAssembler,
    private readonly compiler: PluginCompiler,
    private readonly locator: PluginLocator
  ) {}

  async load(name: $PluginName): Promise<Result<LoadedPlugin, PluginLoadFailure>> {
    const source = this.locator.locate(name);
    if (!source.success) {
      return source;
    }
    const instantiated = await this.compiler.instantiate(source.value);
    if (!instantiated.success) {
      return instantiated;
    }
    return this.assembler.assemble(source.value, instantiated.value);
  }
}
