import { isFunction } from 'es-toolkit';
import type { Promisable } from 'type-fest';
import { z } from 'zod';

import { TOOL_SEGMENT_PATTERN } from '../tools.ts';

import type { AnyTool } from '../toolsets.ts';
import type { PluginToolOutput } from './plugins.types.ts';

const $ZodSchema = z.custom<z.ZodType>((arg) => arg instanceof z.ZodType);

type PluginToolExecute = (args: unknown, context: { readonly [key: string]: unknown }) => Promisable<PluginToolOutput>;

/**
 * One tool of the plugin perimeter (§7): what a `defineTool` factory must have returned. Strict,
 * deliberately: `budgetExempt` is absent from the plugin-facing type, and the unrecognized-key
 * refusal here is what makes that structural — a plugin does not alter how the framework budgets
 * actions (§6).
 */
export type $PluginTool = z.infer<typeof $PluginTool>;
export const $PluginTool = z.strictObject({
  approval: z.custom<NonNullable<AnyTool['approval']>>(isFunction).optional(),
  description: z.string().min(1),
  execute: z.custom<PluginToolExecute>(isFunction),
  parameters: $ZodSchema,
  retryable: z.boolean().optional(),
  timeoutMs: z.number().int().positive().optional(),
  traceDetail: z.custom<NonNullable<AnyTool['traceDetail']>>(isFunction).optional()
});

/**
 * The config half of the plugin perimeter (§7): what a `defineConfig` factory must have returned.
 * Strict at both levels, so a key the contract does not name — `services` above all — is refused
 * rather than ignored.
 */
export type $PluginConfig = z.infer<typeof $PluginConfig>;
export const $PluginConfig = z.strictObject({
  settings: $ZodSchema.optional(),
  storage: z.record(z.string().regex(TOOL_SEGMENT_PATTERN), $ZodSchema).default({})
});
