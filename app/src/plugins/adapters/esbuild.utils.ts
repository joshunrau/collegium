import * as fs from 'node:fs';
import * as path from 'node:path';

import type { BuildFailure } from 'esbuild';

import type { PluginBundleRequest } from '../plugins.types.ts';

function isBuildFailure(error: unknown): error is BuildFailure {
  return typeof error === 'object' && error !== null && Array.isArray((error as { errors?: unknown }).errors);
}

/**
 * esbuild rejects with a `BuildFailure` carrying structured diagnostics and a message that is only
 * a count; the diagnostics are what name the file and line an operator has to go and fix.
 */
export function renderBuildDiagnostics(error: unknown): readonly string[] {
  if (!isBuildFailure(error)) {
    return [error instanceof Error ? error.message : String(error)];
  }
  return error.errors.map((diagnostic) => {
    const location = diagnostic.location;
    const where = location ? `${location.file}:${location.line}:${location.column}: ` : '';
    return `${where}${diagnostic.text}`;
  });
}

/**
 * The entry module the author no longer writes: every conventional file imported as a namespace —
 * so a missing default export is the assembler's precise refusal, not a bundler diagnostic — and
 * exported under the shape the assembler consumes.
 */
export function renderSyntheticEntry({ source }: PluginBundleRequest): string {
  const relative = (file: string) => `./${path.relative(source.packageRoot, path.resolve(source.packageRoot, file))}`;
  const lines = [`import * as config from ${JSON.stringify(relative(source.configPath))};`];
  source.toolFiles.forEach(({ file }, index) => {
    lines.push(`import * as tool_${index} from ${JSON.stringify(relative(file))};`);
  });
  const entries = source.toolFiles.map(({ name }, index) => `${JSON.stringify(name)}: tool_${index}`);
  lines.push(`export default { config, tools: { ${entries.join(', ')} } };`);
  return lines.join('\n');
}

/**
 * esbuild names the importer by its real absolute path on this host; every other file a load failure
 * names is package-root-relative, and inside a container the absolute one is not a path the operator
 * has. The mount may be reached through a symlink, so the root is resolved before the two are
 * compared — and anything still outside it (the synthetic entry itself) is left as it came.
 */
export function renderImporter(packageRoot: string, importer: string): string {
  if (!path.isAbsolute(importer)) {
    return importer;
  }
  const relative = path.relative(fs.realpathSync(packageRoot), importer);
  return relative.startsWith('..') ? importer : relative;
}
