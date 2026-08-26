import * as fs from 'node:fs';
import * as path from 'node:path';

import type { $PluginName } from '@collegium/config';
import { Result } from '@collegium/core/utils';
import { Injectable } from '@nestjs/common';

import { EnvService } from '@/config/env/env.service.ts';

import { SKILLS_DIRECTORY } from '../plugins.constants.ts';
import { $PluginPackageManifest } from '../plugins.schemas.ts';

import type { PluginLoadFailure, PluginSource } from '../plugins.types.ts';

@Injectable()
export class PluginLocator {
  private readonly pluginsRoot: string;

  constructor(envService: EnvService) {
    this.pluginsRoot = envService.get('PLUGINS_ROOT');
  }

  /** the declared plugin as files on disk; nothing here reads the plugin's code or runs it */
  locate(name: $PluginName): Result<PluginSource, PluginLoadFailure.Locate> {
    const packageRoot = path.join(this.pluginsRoot, name);
    if (!fs.statSync(packageRoot, { throwIfNoEntry: false })?.isDirectory()) {
      return Result.err({ kind: 'directory-missing', packageRoot });
    }
    // the mount carries the host's own ownership and modes, and the app runs as neither root nor the
    // operator — an unreadable plugin otherwise surfaces as one that does not exist
    try {
      fs.accessSync(packageRoot, fs.constants.R_OK | fs.constants.X_OK);
    } catch {
      return Result.err({ kind: 'directory-unreadable', packageRoot });
    }
    const entry = this.resolveEntry(packageRoot);
    if (!entry.success) {
      return Result.err(entry.error);
    }
    return Result.ok({
      entry: entry.value,
      name,
      packageRoot,
      skillsDirectory: path.join(path.dirname(entry.value), SKILLS_DIRECTORY)
    });
  }

  private resolveEntry(packageRoot: string): Result<string, PluginLoadFailure.Locate> {
    const manifestPath = path.join(packageRoot, 'package.json');
    if (!fs.existsSync(manifestPath)) {
      return Result.err({ kind: 'manifest-missing', manifestPath });
    }
    let manifest: unknown;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    } catch (error) {
      return Result.err({ cause: error, kind: 'manifest-unreadable', manifestPath });
    }
    const parsed = $PluginPackageManifest.safeParse(manifest);
    if (!parsed.success) {
      return Result.err({ cause: parsed.error, kind: 'manifest-invalid', manifestPath });
    }
    const declaredEntry = parsed.data.exports;
    const entry = path.resolve(packageRoot, typeof declaredEntry === 'string' ? declaredEntry : declaredEntry['.']);
    if (!fs.statSync(entry, { throwIfNoEntry: false })?.isFile()) {
      return Result.err({ entry, kind: 'entry-missing' });
    }
    return Result.ok(entry);
  }
}
