import { Module } from '@nestjs/common';

import { ConfigService } from '@/config/config.service.ts';

import { ESBuildBundler } from './adapters/esbuild.bundler.ts';
import { PluginAssembler } from './loaders/plugin.assembler.ts';
import { PluginCompiler } from './loaders/plugin.compiler.ts';
import { PluginLoader } from './loaders/plugin.loader.ts';
import { PluginLocator } from './loaders/plugin.locator.ts';
import { PluginBundler } from './plugins.bundler.ts';
import { PluginsRegistry } from './plugins.registry.ts';
import { PluginSdk } from './plugins.sdk.ts';
import { pluginLoadFailureCause, renderPluginLoadFailure } from './plugins.utils.ts';

@Module({
  exports: [PluginsRegistry],
  providers: [
    PluginAssembler,
    PluginCompiler,
    PluginLoader,
    PluginLocator,
    PluginSdk,
    { provide: PluginBundler, useClass: ESBuildBundler },
    {
      inject: [ConfigService, PluginLoader],
      provide: PluginsRegistry,
      useFactory: async (configService: ConfigService, pluginLoader: PluginLoader) => {
        const names = configService.get('plugins');
        const loaded = await Promise.all(names.map(async (name) => ({ name, result: await pluginLoader.load(name) })));

        const failures = loaded.flatMap(({ name, result }) => {
          if (result.success) {
            return [];
          }
          const error = new Error(`plugin "${name}": ${renderPluginLoadFailure(result.error)}`, {
            cause: pluginLoadFailureCause(result.error)
          });
          return [error];
        });

        if (failures.length > 0) {
          throw new AggregateError(failures, `failed to load ${failures.length} of ${names.length} plugins`);
        }

        return new PluginsRegistry(loaded.map(({ result }) => result.unwrap()));
      }
    }
  ]
})
export class PluginsModule {}
