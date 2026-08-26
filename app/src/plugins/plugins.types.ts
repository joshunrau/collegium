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

/**
 * Why a declared plugin did not load. Every variant is a startup failure naming the plugin (§3.14),
 * and rendering lives in one place, so a new variant cannot ship without its message.
 */
export declare namespace PluginLoadFailure {
  /** config names a plugin, and nothing is mounted there */
  type DirectoryMissing = {
    kind: 'directory-missing';
    packageRoot: string;
  };
  /** mounted, but the account the app runs as cannot traverse or read it */
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
  /** the plugin's own declaration and the name config loads it by are one identity, stated twice */
  type NameMismatch = {
    declared: string;
    expected: string;
    kind: 'name-mismatch';
  };
  type Locate =
    DirectoryMissing | DirectoryUnreadable | EntryMissing | ManifestInvalid | ManifestMissing | ManifestUnreadable;
  type Bundle = ForbiddenImport | NotCompilable;
  type Compile = Bundle | DefaultExportMissing | NotImportable;
  type Assemble = NameMismatch | ToolsetInvalid;
  type Any = Assemble | Compile | Locate;
}

export type PluginLoadFailure = PluginLoadFailure.Any;
