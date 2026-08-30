import * as path from 'node:path';

import { Result } from '@collegium/core/utils';
import { Injectable } from '@nestjs/common';
import * as esbuild from 'esbuild';

import { PluginBundler } from '../plugins.bundler.ts';
import { SDK_SPECIFIER, ZOD_SPECIFIER } from '../plugins.constants.ts';
import { renderBuildDiagnostics } from './esbuild.utils.ts';

import type { PluginBundleRequest, PluginLoadFailure } from '../plugins.types.ts';

const NODE_BUILTIN_PREFIX = 'node:';

// the plugin directory is the operator's, and a tsconfig found beside its files would make what the
// framework compiles depend on a file the framework does not own
const HERMETIC_TSCONFIG = {};

/**
 * The entry module the author no longer writes: every conventional file imported as a namespace —
 * so a missing default export is the assembler's precise refusal, not a bundler diagnostic — and
 * exported under the shape the assembler consumes.
 */
function renderSyntheticEntry({ configPath, packageRoot, toolFiles }: PluginBundleRequest): string {
  const relative = (file: string) => `./${path.relative(packageRoot, path.resolve(packageRoot, file))}`;
  const lines = [`import * as config from ${JSON.stringify(relative(configPath))};`];
  toolFiles.forEach(({ file }, index) => {
    lines.push(`import * as tool_${index} from ${JSON.stringify(relative(file))};`);
  });
  const entries = toolFiles.map(({ name }, index) => `${JSON.stringify(name)}: tool_${index}`);
  lines.push(`export default { config, tools: { ${entries.join(', ')} } };`);
  return lines.join('\n');
}

@Injectable()
export class ESBuildBundler extends PluginBundler {
  async bundle(request: PluginBundleRequest): Promise<Result<string, PluginLoadFailure.Bundle>> {
    const forbidden: { importer: string; specifier: string }[] = [];
    let bundled;
    try {
      bundled = await esbuild.build({
        bundle: true,
        format: 'esm',
        // the diagnostics are returned to the caller, so esbuild printing them too is noise
        logLevel: 'silent',
        platform: 'node',
        plugins: [
          {
            name: 'collegium-plugin-imports',
            setup: (build) => {
              build.onResolve({ filter: /.*/ }, (args) => {
                if (args.kind === 'entry-point' || args.path.startsWith('.') || path.isAbsolute(args.path)) {
                  return null;
                }
                if (args.path === SDK_SPECIFIER) {
                  return { external: true, path: request.sdkModuleUrl };
                }
                if (args.path === ZOD_SPECIFIER) {
                  return { external: true, path: request.zodModuleUrl };
                }
                if (args.path.startsWith(NODE_BUILTIN_PREFIX)) {
                  return { external: true, path: args.path };
                }
                // recorded rather than raised, so one boot reports every offending import at once;
                // externalising keeps the build going to find the rest, and the output is discarded
                forbidden.push({ importer: args.importer, specifier: args.path });
                return { external: true, path: args.path };
              });
            }
          }
        ],
        sourcemap: 'inline',
        stdin: {
          contents: renderSyntheticEntry(request),
          loader: 'js',
          resolveDir: request.packageRoot,
          sourcefile: '<collegium-plugin-entry>'
        },
        target: `node${process.versions.node.split('.')[0]}`,
        tsconfigRaw: HERMETIC_TSCONFIG,
        write: false
      });
    } catch (error) {
      return Result.err({ kind: 'not-compilable', messages: renderBuildDiagnostics(error) });
    }

    if (forbidden.length > 0) {
      return Result.err({ imports: forbidden, kind: 'forbidden-import' });
    }
    const output = bundled.outputFiles[0];
    if (!output) {
      throw new Error('the bundler produced no output for a build it reported successful');
    }
    return Result.ok(output.text);
  }
}
