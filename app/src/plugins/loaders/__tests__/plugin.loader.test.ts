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

const REPOSITORY_PLUGINS = path.resolve(import.meta.dirname, '../../../../..', 'plugins');

let compilers: PluginCompiler[];
let fixtureRoot: string;

/** a loader rooted where the test needs it, since the root is read once at construction */
async function buildLoader(pluginsRoot: string): Promise<PluginLoader> {
  const envService = MockFactory.createMock(EnvService);
  envService.get.mockReturnValue(pluginsRoot);
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
  compilers.push(moduleRef.get(PluginCompiler));
  return moduleRef.get(PluginLoader);
}

/** a plugin package on disk, as an operator would mount one */
function writeFixture(name: string, files: Readonly<{ [filename: string]: string }>): void {
  const packageRoot = path.join(fixtureRoot, name);
  fs.mkdirSync(path.join(packageRoot, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(packageRoot, 'package.json'),
    JSON.stringify({ exports: './src/index.ts', name, type: 'module', version: '0.0.0' })
  );
  for (const [filename, contents] of Object.entries(files)) {
    fs.writeFileSync(path.join(packageRoot, 'src', filename), contents);
  }
}

describe('PluginLoader', () => {
  beforeEach(() => {
    compilers = [];
    fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'collegium-plugin-fixtures-'));
  });

  afterEach(() => {
    for (const compiler of compilers) {
      compiler.onApplicationShutdown();
    }
    fs.rmSync(fixtureRoot, { force: true, recursive: true });
  });

  it('loads the example plugin from the directory named for it', async () => {
    const loader = await buildLoader(REPOSITORY_PLUGINS);
    const result = await loader.load('bookmark');
    expect(result.success).toBe(true);
    const loaded = result.unwrap();
    expect(loaded.toolset.name).toBe('bookmark');
    expect(Object.keys(loaded.toolset.tools)).toStrictEqual(['list', 'save']);
    expect(loaded.skillsDirectory).toBe(path.join(REPOSITORY_PLUGINS, 'bookmark/src/skills'));
  });

  it('compiles a relative import and a node builtin', async () => {
    writeFixture('helped', {
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
    const loader = await buildLoader(fixtureRoot);
    const result = await loader.load('helped');
    expect(result.success).toBe(true);
    const executed = await result.unwrap().toolset.tools.ping!.execute({}, {} as never);
    expect(executed.unwrap().text).toMatch(/^helped-[0-9a-f]{4}$/);
  });

  it('refuses an import the plugin contract does not permit', async () => {
    writeFixture('reaching', {
      'index.ts': ["import { z } from 'zod';", "import 'date-fns';", 'export default { name: "reaching", z };'].join(
        '\n'
      )
    });
    const loader = await buildLoader(fixtureRoot);
    const result = await loader.load('reaching');
    expect(result.error?.kind).toBe('forbidden-import');
    const message = renderPluginLoadFailure(result.error!);
    expect(message).toContain('"zod"');
    expect(message).toContain('"date-fns"');
    expect(message).toContain('import { z } from "@collegium/sdk"');
  });

  it('rejects a directory whose toolset declares another name', async () => {
    writeFixture('renamed', {
      'index.ts': [
        "import { defineToolset } from '@collegium/sdk';",
        "export default defineToolset({ name: 'elsewhere', tools: {} });"
      ].join('\n')
    });
    const loader = await buildLoader(fixtureRoot);
    const result = await loader.load('renamed');
    expect(result.error?.kind).toBe('name-mismatch');
    expect(renderPluginLoadFailure(result.error!)).toContain("declares the name 'elsewhere'");
  });

  it('rejects a name nothing is mounted under', async () => {
    const loader = await buildLoader(fixtureRoot);
    const result = await loader.load('absent');
    expect(result.error?.kind).toBe('directory-missing');
    expect(renderPluginLoadFailure(result.error!)).toContain('is the plugin mounted there?');
  });
});
