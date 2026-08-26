import type { $PluginToolset } from '@collegium/core/plugins';

/** one plugin's declared skill documents: where they sit, and the namespace qualifying them (§9) */
export type PluginSkillSource = {
  readonly directory: string;
  readonly names: readonly string[];
  readonly namespace: string;
};

/** what a declared plugin resolves to on disk, before anything of it has been read or run */
export type PluginSource = {
  readonly entry: string;
  readonly name: string;
  readonly packageRoot: string;
  readonly skillsDirectory: string;
};

export type PluginBundleRequest = {
  readonly entry: string;
  /** absolute `file:` URL of the framework's own SDK, which every plugin's import of it becomes */
  readonly sdkModuleUrl: string;
};

export type LoadedPlugin = {
  readonly skillsDirectory: string;
  readonly toolset: $PluginToolset;
};

export declare namespace PluginLoadFailure {
  type DirectoryMissing = {
    kind: 'directory-missing';
    packageRoot: string;
  };
  type DirectoryUnreadable = {
    kind: 'directory-unreadable';
    packageRoot: string;
  };
  type ManifestMissing = {
    kind: 'manifest-missing';
    manifestPath: string;
  };
  type ManifestUnreadable = {
    cause: unknown;
    kind: 'manifest-unreadable';
    manifestPath: string;
  };
  type ManifestInvalid = {
    cause: unknown;
    kind: 'manifest-invalid';
    manifestPath: string;
  };
  type DependencyForbidden = {
    kind: 'dependency-forbidden';
    names: readonly string[];
  };
  type SdkDependencyMissing = {
    kind: 'sdk-dependency-missing';
    manifestPath: string;
  };
  type SdkVersionUnsatisfied = {
    declared: string;
    kind: 'sdk-version-unsatisfied';
    version: string;
  };
  type EntryMissing = {
    entry: string;
    kind: 'entry-missing';
  };
  /**
   * The plugin reached past the SDK. Every offending specifier is reported at once, because an
   * operator fixing imports one boot at a time learns nothing the first message could not have told
   * them.
   */
  type ForbiddenImport = {
    imports: readonly { importer: string; specifier: string }[];
    kind: 'forbidden-import';
  };
  type NotCompilable = {
    kind: 'not-compilable';
    messages: readonly string[];
  };
  type NotImportable = {
    cause: unknown;
    kind: 'not-importable';
  };
  type DefaultExportMissing = {
    entry: string;
    kind: 'default-export-missing';
  };
  type ToolsetInvalid = {
    cause: unknown;
    kind: 'toolset-invalid';
  };
  type NameMismatch = {
    declared: string;
    expected: string;
    kind: 'name-mismatch';
  };
  type Locate =
    | DependencyForbidden
    | DirectoryMissing
    | DirectoryUnreadable
    | EntryMissing
    | ManifestInvalid
    | ManifestMissing
    | ManifestUnreadable
    | SdkDependencyMissing
    | SdkVersionUnsatisfied;
  type Bundle = ForbiddenImport | NotCompilable;
  type Compile = Bundle | DefaultExportMissing | NotImportable;
  type Assemble = NameMismatch | ToolsetInvalid;
  type Any = Assemble | Compile | Locate;
}

export type PluginLoadFailure = PluginLoadFailure.Any;
