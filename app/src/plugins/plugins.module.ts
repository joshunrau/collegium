import { Module } from '@nestjs/common';

import { ConfigService } from '@/config/config.service.ts';

import { PluginLoader } from './loaders/plugin.loader.ts';
import { PluginsRegistry } from './plugins.registry.ts';

@Module({
  exports: [PluginsRegistry],
  providers: [
    PluginLoader,
    {
      inject: [ConfigService, PluginLoader],
      provide: PluginsRegistry,
      useFactory: async (configService: ConfigService, pluginLoader: PluginLoader) => {
        const pluginRefs = configService.get('plugins') ?? [];
        const loaded = await Promise.all(
          pluginRefs.map(async (ref) => ({ ref, result: await pluginLoader.load(ref) }))
        );

        const failures = loaded.flatMap(({ ref, result }) => {
          return result.success
            ? []
            : [new Error(`plugin "${ref.name}": ${result.error.message}`, { cause: result.error.cause })];
        });

        if (failures.length > 0) {
          throw new AggregateError(failures, `failed to load ${failures.length} of ${pluginRefs.length} plugins`);
        }

        return new PluginsRegistry(loaded.map(({ result }) => result.unwrap()));
      }
    }
  ]
})
export class PluginsModule {}
