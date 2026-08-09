import { Module } from '@nestjs/common';

import { ConfigService } from '@/config/config.service.ts';

import { PluginLoader } from './loaders/plugin.loader.ts';
import { PluginsRegistry } from './plugins.registry.ts';
import { PluginStorageService } from './storage/plugin-storage.service.ts';

@Module({
  exports: [PluginsRegistry],
  providers: [
    PluginLoader,
    PluginStorageService,
    {
      inject: [ConfigService, PluginLoader, PluginStorageService],
      provide: PluginsRegistry,
      useFactory: async (
        configService: ConfigService,
        pluginLoader: PluginLoader,
        storageService: PluginStorageService
      ) => {
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

        return new PluginsRegistry(
          loaded.map(({ result }) => result.unwrap()),
          storageService
        );
      }
    }
  ]
})
export class PluginsModule {}
