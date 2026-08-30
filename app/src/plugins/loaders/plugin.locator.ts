import * as fs from 'node:fs';
import * as path from 'node:path';

import type { $PluginName } from '@collegium/config';
import { SKILL_NAME_PATTERN } from '@collegium/core/skills';
import { MAX_WIRE_NAME_LENGTH, renderToolWireName, TOOL_SEGMENT_PATTERN } from '@collegium/core/tools';
import { Result } from '@collegium/core/utils';
import { Injectable } from '@nestjs/common';
import { satisfies } from 'semver';

import { EnvService } from '@/config/env/env.service.ts';

import {
  CONFIG_FILE,
  SDK_SPECIFIER,
  SKILL_EXTENSION,
  SKILLS_DIRECTORY,
  TOOL_EXTENSION,
  TOOLS_DIRECTORY,
  ZOD_SPECIFIER
} from '../plugins.constants.ts';
import { PluginPackages } from '../plugins.packages.ts';
import { $PluginPackageManifest } from '../plugins.schemas.ts';
import { discoverConventionalFiles, isRepositoryProtocol } from './plugin.locator.utils.ts';

import type { PluginConventionalFile, PluginLoadFailure, PluginSource } from '../plugins.types.ts';

@Injectable()
export class PluginLocator {
  private readonly pluginsRoot: string;

  constructor(
    envService: EnvService,
    private readonly packages: PluginPackages
  ) {
    this.pluginsRoot = envService.get('PLUGINS_ROOT');
  }

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
    const manifestPath = path.join(packageRoot, 'package.json');
    const manifest = this.readManifest(manifestPath);
    if (!manifest.success) {
      return Result.err(manifest.error);
    }
    const dependencies = this.verifyDependencies(manifest.value.dependencies, manifestPath);
    if (!dependencies.success) {
      return Result.err(dependencies.error);
    }
    const configPath = path.join(packageRoot, CONFIG_FILE);
    if (!fs.statSync(configPath, { throwIfNoEntry: false })?.isFile()) {
      return Result.err({ configPath, kind: 'config-missing' });
    }
    const toolFiles = this.discoverTools(name, packageRoot);
    if (!toolFiles.success) {
      return Result.err(toolFiles.error);
    }
    const skillFiles = this.discoverSkills(packageRoot);
    if (!skillFiles.success) {
      return Result.err(skillFiles.error);
    }
    if (toolFiles.value.length === 0 && skillFiles.value.length === 0) {
      return Result.err({ kind: 'contributes-nothing', packageRoot });
    }
    return Result.ok({
      configPath,
      name,
      packageRoot,
      skillNames: skillFiles.value.map((skill) => skill.name),
      skillsDirectory: path.join(packageRoot, SKILLS_DIRECTORY),
      toolFiles: toolFiles.value
    });
  }

  /** every `src/skills/*.md` is a skill, named by its basename (§9) */
  private discoverSkills(packageRoot: string): Result<PluginConventionalFile[], PluginLoadFailure.Locate> {
    return discoverConventionalFiles(packageRoot, SKILLS_DIRECTORY, SKILL_EXTENSION, (name, file) =>
      SKILL_NAME_PATTERN.test(name) ? undefined : { file, kind: 'skill-name-invalid' }
    );
  }

  /** every `src/tools/*.ts` is a tool, named by its basename — refused, never skipped, when the name will not do */
  private discoverTools(
    pluginName: string,
    packageRoot: string
  ): Result<PluginConventionalFile[], PluginLoadFailure.Locate> {
    return discoverConventionalFiles(packageRoot, TOOLS_DIRECTORY, TOOL_EXTENSION, (name, file) => {
      if (!TOOL_SEGMENT_PATTERN.test(name)) {
        return { file, kind: 'tool-name-invalid' };
      }
      const wireName = renderToolWireName([pluginName, name]);
      return wireName.length > MAX_WIRE_NAME_LENGTH ? { file, kind: 'tool-name-too-long', wireName } : undefined;
    });
  }

  private readManifest(manifestPath: string): Result<$PluginPackageManifest, PluginLoadFailure.Locate> {
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
    return Result.ok(parsed.data);
  }

  /**
   * A plugin may import two packages, so a plugin declares those two and nothing else — checked at
   * the manifest rather than left to the compiler, so the operator reads which dependency is the
   * problem instead of a refused import from somewhere inside a bundle. Both are required, because
   * a range that is never declared is a range this deployment can never check. Each is then checked
   * against the copy this deployment carries, because that copy is what the import becomes.
   */
  private verifyDependencies(
    dependencies: Readonly<{ [name: string]: string }>,
    manifestPath: string
  ): Result<void, PluginLoadFailure.Locate> {
    const forbidden = Object.keys(dependencies).filter((name) => name !== SDK_SPECIFIER && name !== ZOD_SPECIFIER);
    if (forbidden.length > 0) {
      return Result.err({ kind: 'dependency-forbidden', names: forbidden });
    }
    for (const { installed, name } of [
      { installed: this.packages.sdk, name: SDK_SPECIFIER },
      { installed: this.packages.zod, name: ZOD_SPECIFIER }
    ]) {
      const declared = dependencies[name];
      if (declared === undefined) {
        return Result.err({ kind: 'dependency-missing', manifestPath, name });
      }
      if (!isRepositoryProtocol(declared) && !satisfies(installed.version, declared)) {
        return Result.err({ declared, kind: 'dependency-version-unsatisfied', name, version: installed.version });
      }
    }
    return Result.ok();
  }
}
