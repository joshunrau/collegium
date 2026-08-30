import * as fs from 'node:fs';
import * as path from 'node:path';

import type { $PluginName } from '@collegium/config';
import { SKILL_NAME_PATTERN } from '@collegium/core/skills';
import { MAX_WIRE_NAME_LENGTH, renderToolWireName, TOOL_SEGMENT_PATTERN } from '@collegium/core/tools';
import { Result } from '@collegium/core/utils';
import { Injectable } from '@nestjs/common';
import { satisfies } from 'semver';

import { EnvService } from '@/config/env/env.service.ts';

import { CONFIG_FILE, SDK_SPECIFIER, SKILLS_DIRECTORY, TOOLS_DIRECTORY, ZOD_SPECIFIER } from '../plugins.constants.ts';
import { PluginPackages } from '../plugins.packages.ts';
import { $PluginPackageManifest } from '../plugins.schemas.ts';

import type { PluginLoadFailure, PluginSource, PluginToolFile } from '../plugins.types.ts';

/** direct children only: a subdirectory (`__tests__/`) is the author's, and never read */
function listDirectChildren(directory: string, extension: string): string[] {
  if (!fs.statSync(directory, { throwIfNoEntry: false })?.isDirectory()) {
    return [];
  }
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
    .map((entry) => entry.name)
    .sort();
}

/** a workspace or catalog protocol resolves to this very repository's copy, so there is no range to disagree with */
function isRepositoryProtocol(declared: string): boolean {
  return declared.startsWith('workspace:') || declared.startsWith('catalog:');
}

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
    const skillNames = this.discoverSkills(packageRoot);
    if (!skillNames.success) {
      return Result.err(skillNames.error);
    }
    if (toolFiles.value.length === 0 && skillNames.value.length === 0) {
      return Result.err({ kind: 'contributes-nothing', packageRoot });
    }
    return Result.ok({
      configPath,
      name,
      packageRoot,
      skillNames: skillNames.value,
      skillsDirectory: path.join(packageRoot, SKILLS_DIRECTORY),
      toolFiles: toolFiles.value
    });
  }

  /** every `src/skills/*.md` is a skill, named by its basename (§9) */
  private discoverSkills(packageRoot: string): Result<string[], PluginLoadFailure.Locate> {
    const names: string[] = [];
    for (const filename of listDirectChildren(path.join(packageRoot, SKILLS_DIRECTORY), '.md')) {
      const name = filename.slice(0, -'.md'.length);
      if (!SKILL_NAME_PATTERN.test(name)) {
        return Result.err({ file: path.join(SKILLS_DIRECTORY, filename), kind: 'skill-name-invalid' });
      }
      names.push(name);
    }
    return Result.ok(names);
  }

  /** every `src/tools/*.ts` is a tool, named by its basename — refused, never skipped, when the name will not do */
  private discoverTools(pluginName: string, packageRoot: string): Result<PluginToolFile[], PluginLoadFailure.Locate> {
    const toolFiles: PluginToolFile[] = [];
    for (const filename of listDirectChildren(path.join(packageRoot, TOOLS_DIRECTORY), '.ts')) {
      const file = path.join(TOOLS_DIRECTORY, filename);
      const toolName = filename.slice(0, -'.ts'.length);
      if (!TOOL_SEGMENT_PATTERN.test(toolName)) {
        return Result.err({ file, kind: 'tool-name-invalid' });
      }
      const wireName = renderToolWireName([pluginName, toolName]);
      if (wireName.length > MAX_WIRE_NAME_LENGTH) {
        return Result.err({ file, kind: 'tool-name-too-long', wireName });
      }
      toolFiles.push({ file, name: toolName });
    }
    return Result.ok(toolFiles);
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
   * A plugin may import two packages, so a plugin may depend on two packages — checked at the
   * manifest rather than left to the compiler, so the operator reads which dependency is the
   * problem instead of a refused import from somewhere inside a bundle. Each declared range is
   * checked against the copy this deployment carries, because that copy is what the import becomes.
   */
  private verifyDependencies(
    dependencies: Readonly<{ [name: string]: string }>,
    manifestPath: string
  ): Result<void, PluginLoadFailure.Locate> {
    const forbidden = Object.keys(dependencies).filter((name) => name !== SDK_SPECIFIER && name !== ZOD_SPECIFIER);
    if (forbidden.length > 0) {
      return Result.err({ kind: 'dependency-forbidden', names: forbidden });
    }
    if (dependencies[SDK_SPECIFIER] === undefined) {
      return Result.err({ kind: 'sdk-dependency-missing', manifestPath });
    }
    const requirements = [
      { declared: dependencies[SDK_SPECIFIER], installed: this.packages.sdk, name: SDK_SPECIFIER },
      { declared: dependencies[ZOD_SPECIFIER], installed: this.packages.zod, name: ZOD_SPECIFIER }
    ];
    for (const { declared, installed, name } of requirements) {
      if (declared === undefined || isRepositoryProtocol(declared)) {
        continue;
      }
      if (!satisfies(installed.version, declared)) {
        return Result.err({ declared, kind: 'dependency-version-unsatisfied', name, version: installed.version });
      }
    }
    return Result.ok();
  }
}
