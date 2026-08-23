import * as fs from 'node:fs';
import * as path from 'node:path';

import type { ToolFailure } from '@collegium/core/tools';
import { Result } from '@collegium/core/utils';

function deepestExistingAncestor(candidate: string): string {
  let probe = candidate;
  while (!fs.existsSync(probe)) {
    probe = path.dirname(probe);
  }
  return probe;
}

function isWithin(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(root + path.sep);
}

/**
 * The entire confinement boundary for the only tool that mutates anything outside SQLite (§6.1).
 * Every rejection is the model's ordinary mistake, returned as `invalid-arguments` so the turn
 * continues. The root is realpathed before the prefix check so a symlinked workspace does not
 * defeat it, the deepest existing ancestor is realpathed so a symlinked directory inside the
 * workspace cannot lead out of it, and a symlinked target is refused outright.
 *
 * This function is not a validation helper — it is the only thing standing between a tool-only
 * agent and the filesystem, and §6.1 is explicit that this weaker confinement "depends on our
 * code being correct". (The `shell` tool is confined differently: by a dedicated OS user, not by
 * this resolver — the two boundaries are deliberately separate, §A2.) It carries a
 * disproportionate number of tests relative to its size on purpose. Resist every request to
 * widen it; a second gated write tool with its own path handling would be two boundaries that
 * must agree.
 */
export function resolveWorkspacePath(
  workspaceDir: string,
  requested: string
): Result<string, ToolFailure.InvalidArguments> {
  if (path.isAbsolute(requested)) {
    return Result.err({ kind: 'invalid-arguments', message: `"${requested}" is absolute; paths must be relative` });
  }
  const realRoot = fs.realpathSync(workspaceDir);
  const candidate = path.resolve(realRoot, requested);
  if (!isWithin(realRoot, candidate)) {
    return Result.err({ kind: 'invalid-arguments', message: `"${requested}" escapes the workspace` });
  }
  const realAncestor = fs.realpathSync(deepestExistingAncestor(candidate));
  if (!isWithin(realRoot, realAncestor)) {
    return Result.err({ kind: 'invalid-arguments', message: `"${requested}" resolves outside the workspace` });
  }
  if (fs.lstatSync(candidate, { throwIfNoEntry: false })?.isSymbolicLink()) {
    return Result.err({ kind: 'invalid-arguments', message: `"${requested}" is a symbolic link` });
  }
  return Result.ok(candidate);
}
