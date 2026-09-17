import type { AnyToolset } from '@collegium/core/toolsets';

/** one plugin's discovered skills: the directory holding them, and the namespace qualifying them (§3.5) */
export type PluginSkillSource = {
  readonly directory: string;
  readonly names: readonly string[];
  readonly namespace: string;
};

/** one discovered conventional file: the contribution's name, and the package-root-relative file declaring it */
export type PluginConventionalFile = {
  readonly file: string;
  readonly name: string;
};

/** one discovered conventional directory: the contribution's name, and the package-root-relative directory declaring it */
export type PluginConventionalDirectory = {
  readonly directory: string;
  readonly name: string;
};

/** what a declared plugin resolves to on disk, before anything of it has been read or run */
export type PluginSource = {
  readonly configPath: string;
  readonly name: string;
  readonly packageRoot: string;
  readonly skillNames: readonly string[];
  readonly skillsDirectory: string;
  readonly toolFiles: readonly PluginConventionalFile[];
};

export type PluginBundleRequest = {
  /** absolute `file:` URL of the framework's own SDK, which every plugin's import of it becomes */
  readonly sdkModuleUrl: string;
  readonly source: PluginSource;
  /** absolute `file:` URL of the framework's own zod, which every plugin's import of it becomes */
  readonly zodModuleUrl: string;
};

/** an assembled plugin's toolset: `AnyToolset` with the discovered facts guaranteed present */
export type PluginToolset = AnyToolset & {
  readonly skills: readonly string[];
  readonly storage: NonNullable<AnyToolset['storage']>;
};

export type LoadedPlugin = {
  readonly skillsDirectory: string;
  readonly toolset: PluginToolset;
};

/**
 * Every kind names something on the author's or operator's side of the boundary — a file, a
 * manifest, an import, the mount. A failure of the framework's own machinery is a `throw`, not a
 * kind.
 */
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
  type DependencyMissing = {
    kind: 'dependency-missing';
    manifestPath: string;
    name: string;
  };
  type DependencyVersionUnsatisfied = {
    declared: string;
    kind: 'dependency-version-unsatisfied';
    name: string;
    version: string;
  };
  type ConfigMissing = {
    configPath: string;
    kind: 'config-missing';
  };
  type ToolNameInvalid = {
    file: string;
    kind: 'tool-name-invalid';
  };
  type ToolNameTooLong = {
    file: string;
    kind: 'tool-name-too-long';
    wireName: string;
  };
  type SkillNameInvalid = {
    directory: string;
    kind: 'skill-name-invalid';
  };
  /** a skill directory holding no procedure document */
  type SkillDocumentMissing = {
    directory: string;
    kind: 'skill-document-missing';
  };
  /** a direct child of a convention directory that is not of the kind the convention names */
  type UnexpectedEntry = {
    directory: string;
    entry: string;
    kind: 'unexpected-entry';
  };
  /** a direct child of a convention directory the convention does not cover */
  type UnexpectedFile = {
    directory: string;
    extension: string;
    file: string;
    kind: 'unexpected-file';
  };
  type ContributesNothing = {
    kind: 'contributes-nothing';
    packageRoot: string;
  };
  /**
   * The plugin reached past what it may import. Every offending specifier is reported at once,
   * because an operator fixing imports one boot at a time learns nothing the first message could
   * not have told them. `importer` is package-root-relative, like every other file a failure names.
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
  /** `file` is package-root-relative: the config file or one tool file */
  type DefaultExportMissing = {
    file: string;
    kind: 'default-export-missing';
  };
  type ConfigInvalid = {
    cause: unknown;
    kind: 'config-invalid';
  };
  type ToolInvalid = {
    cause: unknown;
    file: string;
    kind: 'tool-invalid';
  };
  /** §3.14 — a tool declaring neither a render function nor `null`: an absent field is not a claim */
  type ToolApprovalUnstated = {
    file: string;
    kind: 'tool-approval-unstated';
    name: string;
  };
  type Locate =
    | ConfigMissing
    | ContributesNothing
    | DependencyForbidden
    | DependencyMissing
    | DependencyVersionUnsatisfied
    | DirectoryMissing
    | DirectoryUnreadable
    | ManifestInvalid
    | ManifestMissing
    | ManifestUnreadable
    | SkillDocumentMissing
    | SkillNameInvalid
    | ToolNameInvalid
    | ToolNameTooLong
    | UnexpectedEntry
    | UnexpectedFile;
  type Bundle = ForbiddenImport | NotCompilable;
  type Compile = Bundle | NotImportable;
  type Assemble = ConfigInvalid | DefaultExportMissing | ToolApprovalUnstated | ToolInvalid;
  type Any = Assemble | Compile | Locate;
}

export type PluginLoadFailure = PluginLoadFailure.Any;
