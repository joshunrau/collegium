import { Result } from '../utils.ts';
import { PluginToolFailureError } from './plugins.errors.ts';

import type { AnyTool } from '../toolsets.ts';
import type { $PluginTool } from './plugins.schemas.ts';
import type { PluginToolErr } from './plugins.types.ts';

/** what a plugin tool receives as `err`; shared with the SDK's testing entry, so a test raises the failure a deployment would */
export const PLUGIN_TOOL_ERR: PluginToolErr = {
  invalidArguments(message) {
    throw new PluginToolFailureError({ kind: 'invalid-arguments', message });
  },
  unresolved(message) {
    throw new PluginToolFailureError({ kind: 'unresolved', message });
  }
};

/**
 * A parsed plugin tool made into the definition the registry and executor consume: `err` handed
 * into the execution context, plain output wrapped into the Result, a raised failure mapped into
 * the taxonomy. Any other throw propagates — the executor already ends the turn on it (§7.1).
 */
export function toFrameworkTool(tool: $PluginTool): AnyTool {
  const { execute, ...declaration } = tool;
  return {
    ...declaration,
    execute: async (args, context) => {
      let output;
      try {
        output = await execute(args, { ...context, err: PLUGIN_TOOL_ERR });
      } catch (error) {
        if (error instanceof PluginToolFailureError) {
          return Result.err(error.failure);
        }
        throw error;
      }
      return Result.ok(typeof output === 'string' ? { text: output } : output);
    }
  };
}
