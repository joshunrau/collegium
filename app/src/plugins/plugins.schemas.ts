import { z } from 'zod';

/**
 * The narrow slice of a plugin's package.json the loader honors: `dependencies`, read to hold the
 * plugin to its one permitted import and to the SDK version it was written against. Everything
 * else — `exports` included, since the layout is conventional — is the author's own business.
 */
export type $PluginPackageManifest = z.infer<typeof $PluginPackageManifest>;
export const $PluginPackageManifest = z.object({
  dependencies: z.record(z.string(), z.string()).default({})
});

/**
 * The manifest of one of the framework's own installed packages, read for the version every
 * plugin's declared range is checked against. Parsed rather than trusted because it is read off
 * disk, and thrown rather than returned because an image whose own package has no version is a
 * broken build, not a deployment mistake.
 */
export type $VersionManifest = z.infer<typeof $VersionManifest>;
export const $VersionManifest = z.object({
  version: z.string().min(1)
});
