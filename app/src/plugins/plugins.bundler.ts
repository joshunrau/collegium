import type { Result } from '@collegium/core/utils';

import type { PluginBundleRequest, PluginLoadFailure } from './plugins.types.ts';

/**
 * The seam in front of the bundler. It takes a plugin's entry file and returns the whole plugin as
 * one ES module with exactly one import left standing — `@collegium/sdk`, rewritten to the
 * framework's own copy, so there is one `zod` in the process by construction. `node:` builtins pass;
 * every other bare specifier is refused rather than resolved, which is what makes §3.14's "a
 * plugin's sole import is `@collegium/sdk`" enforced rather than asserted.
 */
export abstract class PluginBundler {
  abstract bundle(request: PluginBundleRequest): Promise<Result<string, PluginLoadFailure.Bundle>>;
}
