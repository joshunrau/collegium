import { z } from 'zod';

/**
 * The narrow slice of a plugin's package.json the loader honors: the entry as a plain string, or an
 * object whose `"."` is a plain string. Conditional maps and subpaths are refused rather than
 * half-honored. `dependencies` is read to hold the plugin to its one permitted import and to the
 * SDK version it was written against; `devDependencies` are the author's own business.
 */
export type $PluginPackageManifest = z.infer<typeof $PluginPackageManifest>;
export const $PluginPackageManifest = z.object({
  dependencies: z.record(z.string(), z.string()).default({}),
  exports: z.union([z.string(), z.object({ '.': z.string() })])
});

/**
 * The framework's own SDK manifest, read for the version every plugin's declared range is checked
 * against. Parsed rather than trusted because it is read off disk, and thrown rather than returned
 * because an image whose SDK has no version is a broken build, not a deployment mistake.
 */
export type $SdkManifest = z.infer<typeof $SdkManifest>;
export const $SdkManifest = z.object({
  version: z.string().min(1)
});
