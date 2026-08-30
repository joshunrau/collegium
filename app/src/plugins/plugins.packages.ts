import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Injectable } from '@nestjs/common';

import { SDK_SPECIFIER, ZOD_SPECIFIER } from './plugins.constants.ts';
import { $VersionManifest } from './plugins.schemas.ts';

export type InstalledPackage = {
  readonly moduleUrl: string;
  readonly version: string;
};

/**
 * The framework's own copies of the two packages a plugin may import. `@collegium/app` depends on
 * the SDK without importing it — the edge is what carries it through `turbo prune` into the image,
 * and what makes both facts resolve identically in a checkout and in the container.
 *
 * One place knows them, because each answers one question in two forms: a plugin's import is
 * rewritten to `moduleUrl`, and a plugin's declared range is checked against `version`.
 */
@Injectable()
export class PluginPackages {
  readonly sdk = this.resolve(SDK_SPECIFIER);
  readonly zod = this.resolve(ZOD_SPECIFIER);

  private resolve(specifier: string): InstalledPackage {
    const manifestPath = fileURLToPath(import.meta.resolve(`${specifier}/package.json`));
    return {
      moduleUrl: import.meta.resolve(specifier),
      version: $VersionManifest.parse(JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))).version
    };
  }
}
