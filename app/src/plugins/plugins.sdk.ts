import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Injectable } from '@nestjs/common';

import { SDK_SPECIFIER } from './plugins.constants.ts';
import { $SdkManifest } from './plugins.schemas.ts';

/**
 * The framework's own copy of the SDK: where it is, and which version it is. `@collegium/app`
 * depends on the package without importing it — the edge is what carries the SDK through
 * `turbo prune` into the image, and what makes both facts resolve identically in a checkout and in
 * the container.
 *
 * One place knows them, because they answer one question in two forms: every plugin's import is
 * rewritten to `moduleUrl`, and every plugin's declared range is checked against `version`.
 */
@Injectable()
export class PluginSdk {
  readonly moduleUrl = import.meta.resolve(SDK_SPECIFIER);
  readonly version: string;

  constructor() {
    const manifestPath = fileURLToPath(import.meta.resolve(`${SDK_SPECIFIER}/package.json`));
    this.version = $SdkManifest.parse(JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))).version;
  }
}
