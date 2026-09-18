import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';

import { z } from 'zod';

import {
  BINARY_PROBE_BYTES,
  LISTING_CAP_CHARS,
  READ_CAP_CHARS,
  WALK_MAX_DEPTH,
  WALK_MAX_ENTRIES
} from '../workspace.constants.ts';

type WalkedEntry = ResolvedPath & {
  readonly isDirectory: boolean;
  readonly isSymbolicLink: boolean;
  readonly name: string;
};

/** §3.4 — a model-supplied pattern runs on the main thread, so a catastrophic one is stopped here rather than stalling every agent */
const GREP_TIME_BUDGET_MS = 2_000;

const $MatchedLines = z.array(z.number().int().nonnegative());

type BudgetedMatcher = (lines: readonly string[]) => readonly number[];

/**
 * The pattern runs inside a vm context whose timeout V8 honours mid-match, which is what makes a
 * budget enforceable for synchronous regex code; the budget is shared across the files of one grep.
 */
function createBudgetedMatcher(pattern: RegExp, budgetMs: number): BudgetedMatcher {
  const sandbox: { flags: string; lines: readonly string[]; source: string } = {
    flags: pattern.flags,
    lines: [],
    source: pattern.source
  };
  vm.createContext(sandbox);
  vm.runInContext('var pattern = new RegExp(source, flags);', sandbox);
  let remainingMs = budgetMs;
  return (lines) => {
    sandbox.lines = lines;
    const started = Date.now();
    try {
      // parsed at the realm boundary: what comes back from the context is untyped
      return $MatchedLines.parse(
        vm.runInContext('lines.flatMap((line, index) => (pattern.test(line) ? [index] : []))', sandbox, {
          timeout: Math.max(1, remainingMs)
        })
      );
    } finally {
      remainingMs -= Date.now() - started;
    }
  };
}

/** by shape, not `instanceof`: the vm raises it from another realm, and a test runner's realm differs again */
function isExecutionTimeout(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'code' in error && error.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT'
  );
}

/** §7.2 — the filesystem outcomes that are a result the model reads; anything undeclared still throws */
const FILESYSTEM_FAILURES: { readonly [code: string]: string } = {
  EACCES: 'permission denied',
  EISDIR: 'is a directory',
  ELOOP: 'too many levels of symbolic links',
  ENOENT: 'no such file or directory',
  ENOTDIR: 'is not a directory'
};

function describeFilesystemFailure(error: unknown, subject: string): string {
  const reason = error instanceof Error && 'code' in error ? FILESYSTEM_FAILURES[String(error.code)] : undefined;
  if (reason === undefined) {
    throw error;
  }
  return `${subject}: ${reason}`;
}

function capAt(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}\n…truncated at ${limit} characters`;
}

function descend(parent: ResolvedPath, name: string): ResolvedPath {
  return {
    absolute: path.join(parent.absolute, name),
    relative: parent.relative === '.' ? name : path.join(parent.relative, name)
  };
}

function describeKind(stats: fs.Stats): string {
  if (stats.isDirectory()) {
    return 'directory';
  }
  return stats.isFile() ? 'file' : 'other';
}

async function describeEntry(entry: ResolvedPath, dirent: fs.Dirent): Promise<string> {
  if (dirent.isDirectory()) {
    return `${dirent.name}/`;
  }
  if (dirent.isSymbolicLink()) {
    return `${dirent.name} (symbolic link)`;
  }
  const stats = await fs.promises.lstat(entry.absolute);
  return `${dirent.name} (${stats.size} bytes)`;
}

async function readSorted(directory: string): Promise<fs.Dirent[]> {
  const dirents = await fs.promises.readdir(directory, { withFileTypes: true });
  return dirents.sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * Collects entries one directory at a time, stopping at `WALK_MAX_ENTRIES`. A symbolic link is
 * recorded by name and never descended, for the same reason `resolveWorkspacePath` refuses a
 * symlinked target: the confinement is the root, and a link is how a walk leaves it.
 */
async function collectEntries(root: ResolvedPath, maxDepth: number, sink: WalkedEntry[]): Promise<boolean> {
  const queue: { depth: number; directory: ResolvedPath }[] = [{ depth: 0, directory: root }];
  let current = queue.shift();
  while (current !== undefined) {
    for (const dirent of await readSorted(current.directory.absolute)) {
      if (sink.length >= WALK_MAX_ENTRIES) {
        return false;
      }
      const entry = descend(current.directory, dirent.name);
      sink.push({
        ...entry,
        isDirectory: dirent.isDirectory(),
        isSymbolicLink: dirent.isSymbolicLink(),
        name: dirent.name
      });
      if (dirent.isDirectory() && current.depth + 1 < maxDepth) {
        queue.push({ depth: current.depth + 1, directory: entry });
      }
    }
    current = queue.shift();
  }
  return true;
}

/** the cap is applied before the marker so a walk that stopped still says so after a long listing */
function renderWalk(lines: readonly string[], complete: boolean): string {
  const capped = capAt(lines.join('\n'), LISTING_CAP_CHARS);
  return complete ? capped : `${capped}\n…walk stopped after ${WALK_MAX_ENTRIES} entries`;
}

/**
 * A path `resolveWorkspacePath` has already accepted: the absolute form the filesystem takes, and
 * the relative form the model wrote and reads back, so a path these helpers print can be handed
 * straight to another workspace tool.
 */
export type ResolvedPath = {
  readonly absolute: string;
  readonly relative: string;
};

export async function listDirectory(target: ResolvedPath, options: { all: boolean }): Promise<string> {
  let dirents: fs.Dirent[];
  try {
    dirents = await readSorted(target.absolute);
  } catch (error) {
    return describeFilesystemFailure(error, target.relative);
  }
  const shown = dirents.filter((dirent) => options.all || !dirent.name.startsWith('.'));
  if (shown.length === 0) {
    return `${target.relative}: no entries`;
  }
  const lines = await Promise.all(shown.map((dirent) => describeEntry(descend(target, dirent.name), dirent)));
  return capAt(lines.join('\n'), LISTING_CAP_CHARS);
}

export async function readLines(
  target: ResolvedPath,
  range: { endLine?: number; startLine?: number }
): Promise<{ bytes: number; text: string }> {
  let content: string;
  try {
    content = await fs.promises.readFile(target.absolute, 'utf8');
  } catch (error) {
    return { bytes: 0, text: describeFilesystemFailure(error, target.relative) };
  }
  const { endLine, startLine } = range;
  const selected =
    endLine === undefined && startLine === undefined
      ? content
      : content
          .split('\n')
          .slice((startLine ?? 1) - 1, endLine)
          .join('\n');
  if (selected === '') {
    return { bytes: 0, text: `${target.relative}: no content in the requested range` };
  }
  return { bytes: Buffer.byteLength(selected, 'utf8'), text: capAt(selected, READ_CAP_CHARS) };
}

export async function statEntry(target: ResolvedPath): Promise<string> {
  let stats: fs.Stats;
  try {
    stats = await fs.promises.lstat(target.absolute);
  } catch (error) {
    return describeFilesystemFailure(error, target.relative);
  }
  return `${target.relative}: ${describeKind(stats)}, ${stats.size} bytes, modified ${stats.mtime.toISOString()}`;
}

export async function findEntries(
  target: ResolvedPath,
  options: { maxDepth: number; namePattern: string }
): Promise<string> {
  const collected: WalkedEntry[] = [];
  let complete: boolean;
  try {
    complete = await collectEntries(target, options.maxDepth, collected);
  } catch (error) {
    return describeFilesystemFailure(error, target.relative);
  }
  const matched = collected.filter((entry) => path.matchesGlob(entry.name, options.namePattern));
  if (matched.length === 0) {
    return `${target.relative}: nothing matches ${options.namePattern}`;
  }
  return renderWalk(
    matched.map((entry) => (entry.isDirectory ? `${entry.relative}/` : entry.relative)),
    complete
  );
}

export async function grepFiles(
  target: ResolvedPath,
  options: { maxMatches: number; pattern: RegExp }
): Promise<string> {
  const collected: WalkedEntry[] = [];
  let complete: boolean;
  let files: readonly ResolvedPath[];
  try {
    const stats = await fs.promises.lstat(target.absolute);
    if (stats.isSymbolicLink()) {
      return `${target.relative}: is a symbolic link, which the workspace does not follow`;
    }
    complete = stats.isDirectory() ? await collectEntries(target, WALK_MAX_DEPTH, collected) : true;
    files = stats.isDirectory() ? collected.filter((entry) => !entry.isDirectory && !entry.isSymbolicLink) : [target];
  } catch (error) {
    return describeFilesystemFailure(error, target.relative);
  }
  const matchLines = createBudgetedMatcher(options.pattern, GREP_TIME_BUDGET_MS);
  const lines: string[] = [];
  for (const file of files) {
    const content = await fs.promises.readFile(file.absolute);
    if (content.subarray(0, BINARY_PROBE_BYTES).includes(0)) {
      continue;
    }
    const fileLines = content.toString('utf8').split('\n');
    let matched: readonly number[];
    try {
      matched = matchLines(fileLines);
    } catch (error) {
      if (isExecutionTimeout(error)) {
        return `${target.relative}: the pattern took longer than ${GREP_TIME_BUDGET_MS}ms to run and was stopped`;
      }
      throw error;
    }
    for (const index of matched.slice(0, options.maxMatches)) {
      lines.push(`${file.relative}:${index + 1}:${fileLines[index]}`);
    }
  }
  if (lines.length === 0) {
    return `${target.relative}: nothing matches the pattern`;
  }
  return renderWalk(lines, complete);
}
