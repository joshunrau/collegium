import type { BuildFailure } from 'esbuild';

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
