import { z } from 'zod';

/**
 * The narrow slice of a plugin's package.json the loader honors: the entry as a plain string, or an
 * object whose `"."` is a plain string. Conditional maps and subpaths are refused rather than
 * half-honored.
 */
export type $PluginPackageManifest = z.infer<typeof $PluginPackageManifest>;
export const $PluginPackageManifest = z.object({
  exports: z.union([z.string(), z.object({ '.': z.string() })])
});
