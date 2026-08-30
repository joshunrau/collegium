import * as fs from 'node:fs';
import * as path from 'node:path';

import { Result } from '@collegium/core/utils';

import type { PluginConventionalFile, PluginLoadFailure } from '../plugins.types.ts';

/**
 * Direct children only: a subdirectory (`__tests__/`) is the author's, and never read. A hidden
 * file (`.DS_Store`) is the operating system's rather than a contribution, and refusing one would
 * stop a boot because an operator browsed the mount in a file manager.
 */
function listDirectChildren(directory: string): string[] {
  if (!fs.statSync(directory, { throwIfNoEntry: false })?.isDirectory()) {
    return [];
  }
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort();
}

/**
 * A workspace or catalog protocol names this very repository's copy rather than a range, so there
 * is no version for the deployment to disagree with — a plugin developed inside the framework's own
 * workspace tracks it by construction. Anything else states a range and is checked.
 */
export function isRepositoryProtocol(declared: string): boolean {
  return declared.startsWith('workspace:') || declared.startsWith('catalog:');
}

/**
 * The one shape both conventions share: every direct child of the directory is a contribution named
 * by its basename. A file the convention does not cover is refused rather than skipped (§3.14), and
 * a compound extension — `save.test.ts`, `types.d.ts` — is one of those: a conventional file carries
 * exactly one extension, so an author's tests and ambient types belong in a subdirectory.
 */
export function discoverConventionalFiles(
  packageRoot: string,
  directory: string,
  extension: string,
  validate: (name: string, file: string) => PluginLoadFailure.Locate | undefined
): Result<PluginConventionalFile[], PluginLoadFailure.Locate> {
  const discovered: PluginConventionalFile[] = [];
  for (const filename of listDirectChildren(path.join(packageRoot, directory))) {
    const file = path.join(directory, filename);
    const name = filename.slice(0, -extension.length);
    if (!filename.endsWith(extension) || name.includes('.') || name.length === 0) {
      return Result.err({ directory, extension, file, kind: 'unexpected-file' });
    }
    const failure = validate(name, file);
    if (failure !== undefined) {
      return Result.err(failure);
    }
    discovered.push({ file, name });
  }
  return Result.ok(discovered);
}
