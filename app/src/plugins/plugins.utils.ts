import { match } from 'ts-pattern';

import { SDK_SPECIFIER } from './plugins.constants.ts';

import type { PluginLoadFailure } from './plugins.types.ts';

function renderForbiddenImports(imports: PluginLoadFailure.ForbiddenImport['imports']): string {
  const listed = imports.map(({ importer, specifier }) => `"${specifier}" from ${importer}`).join(', ');
  // the likeliest mistake by far, and the one whose fix is least guessable: the SDK re-exports zod,
  // and a second copy of it would be rejected by the toolset perimeter for reasons naming nothing
  const remedy = imports.some(({ specifier }) => specifier === 'zod')
    ? ` — import { z } from "${SDK_SPECIFIER}" rather than from "zod"`
    : '';
  return `a plugin may import only "${SDK_SPECIFIER}" and node: builtins; found ${listed}${remedy}`;
}

/** every load failure reads the same way, and a new variant cannot ship without its message */
export function renderPluginLoadFailure(failure: PluginLoadFailure): string {
  return match(failure)
    .with({ kind: 'default-export-missing' }, ({ entry }) => `'${entry}' is missing its required default export`)
    .with({ kind: 'directory-missing' }, ({ packageRoot }) => {
      return `no directory at ${packageRoot} — is the plugin mounted there?`;
    })
    .with({ kind: 'directory-unreadable' }, ({ packageRoot }) => {
      return `${packageRoot} is not readable by the account the app runs as`;
    })
    .with({ kind: 'entry-missing' }, ({ entry }) => `the entry its package.json declares does not exist: ${entry}`)
    .with({ kind: 'forbidden-import' }, ({ imports }) => renderForbiddenImports(imports))
    .with({ kind: 'manifest-invalid' }, ({ manifestPath }) => {
      return `package.json must declare its entry as "exports" — a plain string, or an object whose "." is a plain string: ${manifestPath}`;
    })
    .with({ kind: 'manifest-missing' }, ({ manifestPath }) => `no package.json at ${manifestPath}`)
    .with({ kind: 'manifest-unreadable' }, ({ manifestPath }) => `package.json is not valid JSON: ${manifestPath}`)
    .with({ kind: 'name-mismatch' }, ({ declared, expected }) => {
      return `it declares the name '${declared}', but config loads it as '${expected}'`;
    })
    .with({ kind: 'not-compilable' }, ({ messages }) => `it did not compile:\n  ${messages.join('\n  ')}`)
    .with({ kind: 'not-importable' }, () => 'the compiled entry could not be evaluated')
    .with({ kind: 'toolset-invalid' }, () => 'its default export is not a toolset the framework accepts')
    .exhaustive();
}

/** the underlying error, where one exists, so a boot failure keeps the stack that explains it */
export function pluginLoadFailureCause(failure: PluginLoadFailure): unknown {
  return 'cause' in failure ? failure.cause : undefined;
}
