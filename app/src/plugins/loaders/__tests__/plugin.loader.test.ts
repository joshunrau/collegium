import * as path from 'node:path';

import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { EnvService } from '@/config/env/env.service.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';

import { PluginLoader } from '../plugin.loader.ts';

/** only the directory matters: plugin paths resolve relative to where config.json sits */
const configPath = path.resolve(import.meta.dirname, '../../../../..', 'config.json');

describe('PluginLoader', () => {
  let pluginLoader: PluginLoader;

  beforeEach(async () => {
    const envService = MockFactory.createMock(EnvService);
    envService.get.mockReturnValue(configPath);
    const moduleRef = await Test.createTestingModule({
      providers: [PluginLoader, { provide: EnvService, useValue: envService }]
    }).compile();
    pluginLoader = moduleRef.get(PluginLoader);
  });

  it('loads the example plugin through its package.json entry', async () => {
    const result = await pluginLoader.load({ name: 'bookmark', path: 'plugins/bookmark' });
    expect(result.success).toBe(true);
    const loaded = result.unwrap();
    expect(loaded.toolset.name).toBe('bookmark');
    expect(Object.keys(loaded.toolset.tools)).toStrictEqual(['list', 'save']);
    expect(loaded.skillsDirectory).toBe(
      path.resolve(import.meta.dirname, '../../../../..', 'plugins/bookmark/src/skills')
    );
  });

  it('rejects a ref whose name does not match the toolset', async () => {
    const result = await pluginLoader.load({ name: 'other', path: 'plugins/bookmark' });
    expect(result.error?.message).toContain(
      "expected plugin name 'bookmark' to match referenced name in config 'other'"
    );
  });

  it('rejects a package root with no package.json', async () => {
    const result = await pluginLoader.load({ name: 'bookmark', path: 'plugins/bookmark/src' });
    expect(result.error?.message).toContain('package manifest does not exist');
  });
});
