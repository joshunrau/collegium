import { match } from 'ts-pattern';

import { CONFIG_FILE, SDK_SPECIFIER, SKILLS_DIRECTORY, TOOLS_DIRECTORY, ZOD_SPECIFIER } from './plugins.constants.ts';

import type { PluginLoadFailure } from './plugins.types.ts';

function renderForbiddenImports(imports: PluginLoadFailure.ForbiddenImport['imports']): string {
  const listed = imports.map(({ importer, specifier }) => `"${specifier}" from ${importer}`).join(', ');
  const remedy = imports.some(({ specifier }) => specifier.startsWith(`${ZOD_SPECIFIER}/`))
    ? ` — import from "${ZOD_SPECIFIER}" itself; its subpaths are not rewritten to the deployment's copy`
    : '';
  return `a plugin may import only "${SDK_SPECIFIER}", "${ZOD_SPECIFIER}", and node: builtins; found ${listed}${remedy}`;
}

export function renderPluginLoadFailure(failure: PluginLoadFailure): string {
  return match(failure)
    .with({ kind: 'config-invalid' }, () => `${CONFIG_FILE} does not declare a config the framework accepts`)
    .with({ kind: 'config-missing' }, ({ configPath }) => `no ${CONFIG_FILE} at ${configPath}`)
    .with(
      { kind: 'contributes-nothing' },
      ({ packageRoot }) =>
        `${packageRoot} has no ${TOOLS_DIRECTORY}/*.ts and no ${SKILLS_DIRECTORY}/*.md — nothing to contribute`
    )
    .with({ kind: 'default-export-missing' }, ({ file }) => `${file} is missing its required default export`)
    .with(
      { kind: 'dependency-forbidden' },
      ({ names }) =>
        `its package.json depends on ${names.map((name) => `"${name}"`).join(', ')}; a plugin may depend on "${SDK_SPECIFIER}" and "${ZOD_SPECIFIER}" alone`
    )
    .with(
      { kind: 'dependency-version-unsatisfied' },
      ({ declared, name, version }) =>
        `it was written against "${name}" ${declared}, and this deployment carries ${name} ${version}`
    )
    .with({ kind: 'directory-missing' }, ({ packageRoot }) => {
      return `no directory at ${packageRoot} — is the plugin mounted there?`;
    })
    .with({ kind: 'directory-unreadable' }, ({ packageRoot }) => {
      return `${packageRoot} is not readable by the account the app runs as`;
    })
    .with({ kind: 'forbidden-import' }, ({ imports }) => renderForbiddenImports(imports))
    .with({ kind: 'manifest-invalid' }, ({ manifestPath }) => {
      return `package.json could not be read as a manifest: ${manifestPath}`;
    })
    .with({ kind: 'manifest-missing' }, ({ manifestPath }) => `no package.json at ${manifestPath}`)
    .with({ kind: 'manifest-unreadable' }, ({ manifestPath }) => `package.json is not valid JSON: ${manifestPath}`)
    .with({ kind: 'not-compilable' }, ({ messages }) => `it did not compile:\n  ${messages.join('\n  ')}`)
    .with({ kind: 'not-importable' }, () => 'the compiled plugin could not be evaluated')
    .with(
      { kind: 'sdk-dependency-missing' },
      ({ manifestPath }) => `${manifestPath} declares no dependency on "${SDK_SPECIFIER}"`
    )
    .with(
      { kind: 'skill-name-invalid' },
      ({ file }) => `${file} does not name a skill: the basename must be lowercase and dashed`
    )
    .with({ kind: 'tool-invalid' }, ({ file }) => `the tool ${file} declares is not one the framework accepts`)
    .with(
      { kind: 'tool-name-invalid' },
      ({ file }) => `${file} does not name a tool: the basename must be lowercase snake_case with single underscores`
    )
    .with(
      { kind: 'tool-name-too-long' },
      ({ file, wireName }) => `${file} names a tool whose wire name "${wireName}" exceeds the provider limit`
    )
    .exhaustive();
}

export function pluginLoadFailureCause(failure: PluginLoadFailure): unknown {
  return 'cause' in failure ? failure.cause : undefined;
}
