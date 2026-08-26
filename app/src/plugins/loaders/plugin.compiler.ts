import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

import { Result } from '@collegium/core/utils';
import { Injectable } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';

import { PluginBundler } from '../plugins.bundler.ts';
import { PluginSdk } from '../plugins.sdk.ts';

import type { PluginLoadFailure, PluginSource } from '../plugins.types.ts';

const BUNDLE_DIRECTORY_PREFIX = 'collegium-plugins-';

@Injectable()
export class PluginCompiler implements OnApplicationShutdown {
  private bundleDirectory: string | undefined;

  constructor(
    private readonly bundler: PluginBundler,
    private readonly sdk: PluginSdk
  ) {}

  async compileToDiskAndImport(source: PluginSource): Promise<Result<unknown, PluginLoadFailure.Compile>> {
    const bundled = await this.bundler.bundle({ entry: source.entry, sdkModuleUrl: this.sdk.moduleUrl });
    if (!bundled.success) {
      return Result.err(bundled.error);
    }

    // a `data:` module would need no directory at all, but Node maps no source map onto one, and a
    // plugin's stack trace is the whole diagnosis when operator code fails in production
    this.bundleDirectory ??= fs.mkdtempSync(path.join(os.tmpdir(), BUNDLE_DIRECTORY_PREFIX));
    const bundlePath = path.join(this.bundleDirectory, `${source.name}.mjs`);

    let module: unknown;
    try {
      fs.writeFileSync(bundlePath, bundled.value, { mode: 0o600 });
      module = await import(pathToFileURL(bundlePath).href);
    } catch (error) {
      return Result.err({ cause: error, kind: 'not-importable' });
    }

    // not isPlainObject: an ESM namespace object carries Symbol.toStringTag 'Module', which plain-object checks reject
    if (typeof module !== 'object' || module === null || !('default' in module)) {
      return Result.err({ entry: source.entry, kind: 'default-export-missing' });
    }
    return Result.ok(module.default);
  }

  onApplicationShutdown(): void {
    if (this.bundleDirectory !== undefined) {
      fs.rmSync(this.bundleDirectory, { force: true, recursive: true });
      this.bundleDirectory = undefined;
    }
  }
}
