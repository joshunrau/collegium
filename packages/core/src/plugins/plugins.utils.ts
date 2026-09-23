import { Result } from '../utils.ts';
import { PluginToolFailureError } from './plugins.errors.ts';

import type { ToolDefinition } from '../tools.ts';
import type { AnyTool, ToolsetContext } from '../toolsets.ts';
import type { $PluginTool } from './plugins.schemas.ts';
import type { PluginToolErr, PluginToolHandles, PluginToolsetServices } from './plugins.types.ts';

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
 * A parsed plugin tool made into the definition the registry and executor consume: `err` and the
 * work-unit reader, bound to the call's turn, handed into the execution context in place of the
 * lookup behind it; plain output wrapped into the Result; a raised failure mapped into the
 * taxonomy. Any other throw propagates — the executor already ends the turn on it (§7.1). A stated
 * `approval: null` becomes an absent key here, so presence alone remains the gate (§3.4).
 */
export function toFrameworkTool(tool: $PluginTool): AnyTool {
  const { approval, execute, ...declaration } = tool;
  const definition: ToolDefinition<ToolsetContext<PluginToolsetServices>, AnyTool['parameters']> = {
    ...declaration,
    ...(approval === null ? {} : { approval }),
    execute: async (args, { workUnitLookup, ...context }) => {
      const handles: PluginToolHandles = {
        err: PLUGIN_TOOL_ERR,
        workUnits: {
          find: (reference) => {
            const { agentUsername, channelId } = context.turn;
            return workUnitLookup.findWorkUnitView({ agentUsername, channelId, reference });
          }
        }
      };
      let output;
      try {
        output = await execute(args, { ...context, ...handles });
      } catch (error) {
        if (error instanceof PluginToolFailureError) {
          return Result.err(error.failure);
        }
        throw error;
      }
      return Result.ok(typeof output === 'string' ? { text: output } : output);
    }
  };
  return definition;
}
