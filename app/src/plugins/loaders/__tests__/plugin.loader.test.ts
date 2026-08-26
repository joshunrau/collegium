import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { EnvService } from '@/config/env/env.service.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';

import { ESBuildBundler } from '../../adapters/esbuild.bundler.ts';
import { PluginBundler } from '../../plugins.bundler.ts';
import { renderPluginLoadFailure } from '../../plugins.utils.ts';
import { PluginAssembler } from '../plugin.assembler.ts';
import { PluginCompiler } from '../plugin.compiler.ts';
import { PluginLoader } from '../plugin.loader.ts';
import { PluginLocator } from '../plugin.locator.ts';

/** only the directory matters: plugin paths resolve relative to where config.json sits */
const configPath = path.resolve(import.meta.dirname, '../../../../..', 'config.json');

let fixtureRoot: string;

/** a plugin package on disk, as an operator would mount one */
function writeFixture(name: string, files: Readonly<{ [filename: string]: string }>): string {
  const packageRoot = path.join(fixtureRoot, name);
  fs.mkdirSync(path.join(packageRoot, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(packageRoot, 'package.json'),
    JSON.stringify({ exports: './src/index.ts', name, type: 'module', version: '0.0.0' })
  );
  for (const [filename, contents] of Object.entries(files)) {
    fs.writeFileSync(path.join(packageRoot, 'src', filename), contents);
  }
  return packageRoot;
}

describe('PluginLoader', () => {
  let pluginLoader: PluginLoader;
  let pluginCompiler: PluginCompiler;

  beforeEach(async () => {
    fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'collegium-plugin-fixtures-'));
    const envService = MockFactory.createMock(EnvService);
    envService.get.mockReturnValue(configPath);
    const moduleRef = await Test.createTestingModule({
      providers: [
        PluginAssembler,
        PluginCompiler,
        PluginLoader,
        PluginLocator,
        { provide: EnvService, useValue: envService },
        { provide: PluginBundler, useClass: ESBuildBundler }
      ]
    }).compile();
    pluginLoader = moduleRef.get(PluginLoader);
    pluginCompiler = moduleRef.get(PluginCompiler);
  });

  afterEach(() => {
    pluginCompiler.onApplicationShutdown();
    fs.rmSync(fixtureRoot, { force: true, recursive: true });
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

  it('compiles a relative import and a node builtin', async () => {
    const packageRoot = writeFixture('helped', {
      'helper.ts': 'export const helped = (): string => "helped";',
      'index.ts': [
        "import { randomUUID } from 'node:crypto';",
        "import { defineToolset, ok, z } from '@collegium/sdk';",
        "import { helped } from './helper.ts';",
        'export default defineToolset({',
        "  name: 'helped',",
        '  tools: {',
        '    ping: {',
        "      description: 'p',",
        '      execute: async () => ok(`${helped()}-${randomUUID().slice(0, 4)}`),',
        '      parameters: z.object({})',
        '    }',
        '  }',
        '});'
      ].join('\n')
    });
    const result = await pluginLoader.load({ name: 'helped', path: packageRoot });
    expect(result.success).toBe(true);
    const executed = await result.unwrap().toolset.tools.ping!.execute({}, {} as never);
    expect(executed.unwrap().text).toMatch(/^helped-[0-9a-f]{4}$/);
  });

  it('refuses an import the plugin contract does not permit', async () => {
    const packageRoot = writeFixture('reaching', {
      'index.ts': ["import { z } from 'zod';", "import 'date-fns';", 'export default { name: "reaching", z };'].join(
        '\n'
      )
    });
    const result = await pluginLoader.load({ name: 'reaching', path: packageRoot });
    expect(result.error?.kind).toBe('forbidden-import');
    const message = renderPluginLoadFailure(result.error!);
    expect(message).toContain('"zod"');
    expect(message).toContain('"date-fns"');
    expect(message).toContain('import { z } from "@collegium/sdk"');
  });

  it('rejects a ref whose name does not match the toolset', async () => {
    const result = await pluginLoader.load({ name: 'other', path: 'plugins/bookmark' });
    expect(result.error?.kind).toBe('name-mismatch');
    expect(renderPluginLoadFailure(result.error!)).toContain("declares the name 'bookmark'");
  });

  it('rejects a package root with no package.json', async () => {
    const result = await pluginLoader.load({ name: 'bookmark', path: 'plugins/bookmark/src' });
    expect(result.error?.kind).toBe('manifest-missing');
  });
});
