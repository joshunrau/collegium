import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { EnvService } from '@/config/env/env.service.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';

import { ESBuildBundler } from '../../adapters/esbuild.bundler.ts';
import { PluginBundler } from '../../plugins.bundler.ts';
import { PluginPackages } from '../../plugins.packages.ts';
import { renderPluginLoadFailure } from '../../plugins.utils.ts';
import { PluginAssembler } from '../plugin.assembler.ts';
import { PluginCompiler } from '../plugin.compiler.ts';
import { PluginLoader } from '../plugin.loader.ts';
import { PluginLocator } from '../plugin.locator.ts';

const REPOSITORY_PLUGINS = path.resolve(import.meta.dirname, '../../../../..', 'plugins');

/** the versions a fixture is written against; the real ones belong to the deployment, not the test */
const SDK_VERSION = '1.2.3';
const ZOD_VERSION = '4.0.0';
const PACKAGES = {
  sdk: { moduleUrl: import.meta.resolve('@collegium/sdk'), version: SDK_VERSION },
  zod: { moduleUrl: import.meta.resolve('zod'), version: ZOD_VERSION }
};

const MINIMAL_CONFIG = 'export default {};';

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
      { provide: PluginBundler, useClass: ESBuildBundler },
      { provide: PluginPackages, useValue: PACKAGES }
    ]
  }).compile();
  compilers.push(moduleRef.get(PluginCompiler));
  return moduleRef.get(PluginLoader);
}

/** a plugin package on disk, as an operator would mount one; keys are package-root-relative paths */
function writeFixture(
  name: string,
  files: Readonly<{ [file: string]: string }>,
  dependencies: Readonly<{ [name: string]: string }> = { '@collegium/sdk': `^${SDK_VERSION}` }
): void {
  const packageRoot = path.join(fixtureRoot, name);
  fs.mkdirSync(packageRoot, { recursive: true });
  fs.writeFileSync(
    path.join(packageRoot, 'package.json'),
    JSON.stringify({ dependencies, name, type: 'module', version: '0.0.0' })
  );
  for (const [file, contents] of Object.entries(files)) {
    const target = path.join(packageRoot, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
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
    expect(loaded.toolset.skills).toStrictEqual(['saving-bookmarks']);
    expect(Object.keys(loaded.toolset.storage)).toStrictEqual(['bookmarks']);
    expect(loaded.skillsDirectory).toBe(path.join(REPOSITORY_PLUGINS, 'bookmark/src/skills'));
  });

  it('compiles a relative import and a node builtin, rewriting zod to the deployment copy', async () => {
    writeFixture('helped', {
      'src/config.ts': MINIMAL_CONFIG,
      'src/helpers.ts': 'export const helped = (): string => "helped";',
      'src/tools/ping.ts': [
        "import { randomUUID } from 'node:crypto';",
        "import { z } from 'zod';",
        "import { helped } from '../helpers.ts';",
        'export default {',
        "  description: 'p',",
        '  execute: async () => `${helped()}-${randomUUID().slice(0, 4)}`,',
        '  parameters: z.object({})',
        '};'
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
      'src/config.ts': MINIMAL_CONFIG,
      'src/tools/reach.ts': ["import 'date-fns';", "import 'zod/mini';", 'export default {};'].join('\n')
    });
    const loader = await buildLoader(fixtureRoot);
    const result = await loader.load('reaching');
    expect(result.error?.kind).toBe('forbidden-import');
    const message = renderPluginLoadFailure(result.error!);
    expect(message).toContain('"date-fns"');
    expect(message).toContain('"zod/mini"');
    expect(message).toContain('subpaths are not rewritten');
  });

  it('rejects a plugin without a config file', async () => {
    writeFixture('unconfigured', { 'src/tools/ping.ts': 'export default {};' });
    const loader = await buildLoader(fixtureRoot);
    const result = await loader.load('unconfigured');
    expect(result.error?.kind).toBe('config-missing');
  });

  it('rejects a tool file whose basename is outside the segment grammar', async () => {
    writeFixture('dashed', {
      'src/config.ts': MINIMAL_CONFIG,
      'src/tools/save-it.ts': 'export default {};'
    });
    const loader = await buildLoader(fixtureRoot);
    const result = await loader.load('dashed');
    expect(result.error?.kind).toBe('tool-name-invalid');
    expect(renderPluginLoadFailure(result.error!)).toContain('src/tools/save-it.ts');
  });

  it('rejects a plugin with no tools and no skills', async () => {
    writeFixture('inert', { 'src/config.ts': MINIMAL_CONFIG });
    const loader = await buildLoader(fixtureRoot);
    const result = await loader.load('inert');
    expect(result.error?.kind).toBe('contributes-nothing');
  });

  it('rejects a tool file without a default export', async () => {
    writeFixture('exportless', {
      'src/config.ts': MINIMAL_CONFIG,
      'src/tools/quiet.ts': 'export const quiet = 1;'
    });
    const loader = await buildLoader(fixtureRoot);
    const result = await loader.load('exportless');
    expect(result.error?.kind).toBe('default-export-missing');
    expect(renderPluginLoadFailure(result.error!)).toContain('src/tools/quiet.ts');
  });

  it('reports a module whose evaluation throws', async () => {
    writeFixture('throwing', {
      'src/config.ts': "throw new Error('bad config');",
      'src/tools/ping.ts': 'export default {};'
    });
    const loader = await buildLoader(fixtureRoot);
    const result = await loader.load('throwing');
    expect(result.error?.kind).toBe('not-importable');
  });

  it('rejects a plugin depending on anything but the sdk and zod', async () => {
    writeFixture('vendored', { 'src/config.ts': MINIMAL_CONFIG }, { '@collegium/sdk': '*', 'date-fns': '^4.0.0' });
    const loader = await buildLoader(fixtureRoot);
    const result = await loader.load('vendored');
    expect(result.error?.kind).toBe('dependency-forbidden');
    expect(renderPluginLoadFailure(result.error!)).toContain('"date-fns"');
  });

  it('rejects a plugin written against an sdk this deployment does not carry', async () => {
    writeFixture('ahead', { 'src/config.ts': MINIMAL_CONFIG }, { '@collegium/sdk': '^2.0.0' });
    const loader = await buildLoader(fixtureRoot);
    const result = await loader.load('ahead');
    expect(result.error?.kind).toBe('dependency-version-unsatisfied');
    expect(renderPluginLoadFailure(result.error!)).toContain(`carries @collegium/sdk ${SDK_VERSION}`);
  });

  it('rejects a plugin written against a zod this deployment does not carry', async () => {
    writeFixture(
      'mismatched',
      { 'src/config.ts': MINIMAL_CONFIG },
      { '@collegium/sdk': `^${SDK_VERSION}`, zod: '^9.0.0' }
    );
    const loader = await buildLoader(fixtureRoot);
    const result = await loader.load('mismatched');
    expect(result.error?.kind).toBe('dependency-version-unsatisfied');
    expect(renderPluginLoadFailure(result.error!)).toContain(`carries zod ${ZOD_VERSION}`);
  });

  it('rejects a name nothing is mounted under', async () => {
    const loader = await buildLoader(fixtureRoot);
    const result = await loader.load('absent');
    expect(result.error?.kind).toBe('directory-missing');
    expect(renderPluginLoadFailure(result.error!)).toContain('is the plugin mounted there?');
  });
});
