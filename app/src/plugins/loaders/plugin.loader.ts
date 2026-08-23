import * as fs from 'node:fs';
import * as path from 'node:path';

import { $PluginToolset } from '@collegium/core/plugins';
import { loadSkillLibrary } from '@collegium/core/skills';
import { Result } from '@collegium/core/utils';
import { Injectable } from '@nestjs/common';

import type { $PluginRef } from '@/config/config.schemas.ts';
import { EnvService } from '@/config/env/env.service.ts';

import { $PluginPackageManifest } from '../plugins.schemas.ts';

import type { LoadedPlugin } from '../plugins.types.ts';

type PluginLoadError = {
  cause?: unknown;
  message: string;
};

const SKILLS_DIRECTORY = 'skills';

@Injectable()
export class PluginLoader {
  private readonly configPath: string;

  constructor(envService: EnvService) {
    this.configPath = envService.get('CONFIG_PATH');
  }

  async load(ref: $PluginRef): Promise<Result<LoadedPlugin, PluginLoadError>> {
    const packageRoot = path.resolve(path.dirname(this.configPath), ref.path);
    if (!fs.existsSync(packageRoot) || !fs.statSync(packageRoot).isDirectory()) {
      return Result.err({ message: `package root is not a directory: ${packageRoot}` });
    }

    const entry = this.resolveEntry(packageRoot);
    if (!entry.success) {
      return Result.err(entry.error);
    }

    let module: unknown;
    try {
      module = await import(entry.value);
    } catch (error) {
      return Result.err({ cause: error, message: `failed to load entry module: '${entry.value}'` });
    }

    // not isPlainObject: an ESM namespace object carries Symbol.toStringTag 'Module', which plain-object checks reject
    if (typeof module !== 'object' || module === null || !('default' in module)) {
      return Result.err({ message: `module '${entry.value}' is missing required default export` });
    }

    const parsed = await $PluginToolset.safeParseAsync(module.default);
    if (!parsed.success) {
      return Result.err({ cause: parsed.error, message: `invalid toolset from module '${entry.value}'` });
    }

    const toolset = parsed.data;
    if (toolset.name !== ref.name) {
      return Result.err({
        message: `expected plugin name '${toolset.name}' to match referenced name in config '${ref.name}'`
      });
    }

    const skills = this.loadSkills(path.dirname(entry.value), toolset.skills);
    if (!skills.success) {
      return Result.err(skills.error);
    }

    return Result.ok({ skills: skills.value, toolset });
  }

  /** skill documents are assets of the module, so they resolve beside the entry, not the package root */
  private loadSkills(entryDir: string, names: readonly string[]): Result<LoadedPlugin['skills'], PluginLoadError> {
    if (names.length === 0) {
      return Result.ok({});
    }
    try {
      return Result.ok(loadSkillLibrary(path.join(entryDir, SKILLS_DIRECTORY), names));
    } catch (error) {
      return Result.err({ cause: error, message: 'failed to load a declared skill document' });
    }
  }

  private resolveEntry(packageRoot: string): Result<string, PluginLoadError> {
    const manifestPath = path.join(packageRoot, 'package.json');
    if (!fs.existsSync(manifestPath)) {
      return Result.err({ message: `package manifest does not exist: ${manifestPath}` });
    }
    let manifest: unknown;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    } catch (error) {
      return Result.err({ cause: error, message: `package manifest is not valid JSON: ${manifestPath}` });
    }
    const parsed = $PluginPackageManifest.safeParse(manifest);
    if (!parsed.success) {
      return Result.err({
        cause: parsed.error,
        message: `package manifest must declare its entry as "exports" — a plain string or an object whose "." is a plain string: ${manifestPath}`
      });
    }
    const declaredEntry = parsed.data.exports;
    const entry = path.resolve(packageRoot, typeof declaredEntry === 'string' ? declaredEntry : declaredEntry['.']);
    if (!fs.existsSync(entry) || !fs.statSync(entry).isFile()) {
      return Result.err({ message: `declared entry module does not exist: ${entry}` });
    }
    return Result.ok(entry);
  }
}
