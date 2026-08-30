import type { PluginToolDeclaration, PluginToolErr } from '@collegium/core/plugins';
import type { EmptyDeclaration, ToolsetContext } from '@collegium/core/toolsets';
import type { z } from 'zod';

import type { RegisteredConfig } from './config.ts';

/** what `execute` receives: the registered config's settings and storage, the failure raisers, and the four facts of the turn */
export type ToolContext = ToolsetContext<
  EmptyDeclaration,
  RegisteredConfig['settings'],
  RegisteredConfig['storage']
> & {
  readonly err: PluginToolErr;
};

export type PluginTool<TParams extends z.ZodType> = PluginToolDeclaration<ToolContext, TParams>;

/** identity at runtime; what it is for is typing `args` from `parameters` across the whole declaration */
export function defineTool<TParams extends z.ZodType>(tool: PluginTool<TParams>): PluginTool<TParams> {
  return tool;
}
