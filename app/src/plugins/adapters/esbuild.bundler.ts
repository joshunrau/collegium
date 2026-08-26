import * as path from 'node:path';

import { Result } from '@collegium/core/utils';
import { Injectable } from '@nestjs/common';
import * as esbuild from 'esbuild';

import { PluginBundler } from '../plugins.bundler.ts';
import { SDK_SPECIFIER } from '../plugins.constants.ts';
import { renderBuildDiagnostics } from './esbuild.utils.ts';

import type { PluginBundleRequest, PluginLoadFailure } from '../plugins.types.ts';

const NODE_BUILTIN_PREFIX = 'node:';

// the plugin directory is the operator's, and a tsconfig found beside its entry would make what the
// framework compiles depend on a file the framework does not own
const HERMETIC_TSCONFIG = {};

@Injectable()
export class ESBuildBundler extends PluginBundler {
  async bundle({ entry, sdkModuleUrl }: PluginBundleRequest): Promise<Result<string, PluginLoadFailure.Bundle>> {
    const forbidden: { importer: string; specifier: string }[] = [];
    let bundled;
    try {
      bundled = await esbuild.build({
        bundle: true,
        entryPoints: [entry],
        format: 'esm',
        // the diagnostics are returned to the caller, so esbuild printing them too is noise
        logLevel: 'silent',
        platform: 'node',
        plugins: [
          {
            name: 'collegium-plugin-imports',
            setup: (build) => {
              build.onResolve({ filter: /.*/ }, (args) => {
                // relative and absolute paths are the plugin's own files, resolved as usual
                if (args.kind === 'entry-point' || args.path.startsWith('.') || path.isAbsolute(args.path)) {
                  return null;
                }
                if (args.path === SDK_SPECIFIER) {
                  return { external: true, path: sdkModuleUrl };
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
      return Result.err({ kind: 'not-compilable', messages: ['the bundler produced no output'] });
    }
    return Result.ok(output.text);
  }
}
