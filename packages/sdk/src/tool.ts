import type { PluginToolDeclaration, PluginToolErr } from '@collegium/core/plugins';
import type { ToolApprovalContext } from '@collegium/core/tools';
import type { EmptyDeclaration, ToolsetContext } from '@collegium/core/toolsets';
import type { z } from 'zod';

import type { PluginConfig, RegisteredConfig } from './config.ts';

/** what `execute` receives under a config: its settings and storage, the failure raisers, and the four facts of the turn */
export type ToolContextFor<TConfig extends PluginConfig> = ToolsetContext<
  EmptyDeclaration,
  TConfig['settings'],
  TConfig['storage']
> & {
  readonly err: PluginToolErr;
};

/** the context under the registered config: what every tool file's `execute` receives */
export type ToolContext = ToolContextFor<RegisteredConfig>;

/** what `approval` receives under a config: the settings, and of each collection only the methods that read (§3.4) */
export type ApprovalContextFor<TConfig extends PluginConfig> = ToolApprovalContext<ToolContextFor<TConfig>>;

/** the approval context under the registered config: what every tool file's `approval` receives */
export type ApprovalContext = ApprovalContextFor<RegisteredConfig>;

export type PluginTool<TParams extends z.ZodType> = PluginToolDeclaration<ToolContext, TParams>;

/** identity at runtime; what it is for is typing `args` from `parameters` across the whole declaration */
export function defineTool<TParams extends z.ZodType>(tool: PluginTool<TParams>): PluginTool<TParams> {
  return tool;
}
