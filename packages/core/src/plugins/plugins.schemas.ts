import { isFunction } from 'es-toolkit';
import { z } from 'zod';

import { SKILL_NAME_PATTERN } from '../skills.ts';
import { MAX_WIRE_NAME_LENGTH, renderToolWireName, TOOL_SEGMENT_PATTERN } from '../tools.ts';
import { isUnique } from '../utils.ts';

import type { AnyTool } from '../toolsets.ts';

const $ZodSchema = z.custom<z.ZodType>((arg) => arg instanceof z.ZodType);

/**
 * One tool of a plugin toolset, structurally. Strict, deliberately: `budgetExempt` is absent from
 * the plugin-facing type, and the unrecognized-key refusal here is what makes that structural —
 * a plugin does not alter how the framework budgets actions (§6).
 */
const $PluginToolDefinition = z.strictObject({
  approval: z.custom<NonNullable<AnyTool['approval']>>(isFunction).optional(),
  description: z.string().min(1),
  execute: z.custom<AnyTool['execute']>(isFunction),
  parameters: $ZodSchema,
  retryable: z.boolean().optional(),
  timeoutMs: z.number().int().positive().optional(),
  traceDetail: z.custom<NonNullable<AnyTool['traceDetail']>>(isFunction).optional()
});

/**
 * The plugin perimeter (§7): what an entry module's default export must be. Strict at both levels,
 * so `services` on the toolset is refused the same way `budgetExempt` on a tool is. Tool names are
 * unique by construction — the name is the record key.
 */
export type $PluginToolset = z.infer<typeof $PluginToolset>;
export const $PluginToolset = z
  .strictObject({
    name: z.string().regex(TOOL_SEGMENT_PATTERN),
    settings: $ZodSchema.optional(),
    skills: z.array(z.string().regex(SKILL_NAME_PATTERN)).default([]),
    storage: z.record(z.string().regex(TOOL_SEGMENT_PATTERN), $ZodSchema).optional(),
    tools: z.record(z.string().regex(TOOL_SEGMENT_PATTERN), $PluginToolDefinition)
  })
  .check((ctx) => {
    const { name, skills, tools } = ctx.value;
    if (!isUnique(skills)) {
      ctx.issues.push({ code: 'custom', input: skills, message: 'skill names must be unique', path: ['skills'] });
    }
    for (const toolName of Object.keys(tools)) {
      const wireName = renderToolWireName([name, toolName]);
      if (wireName.length > MAX_WIRE_NAME_LENGTH) {
        ctx.issues.push({
          code: 'custom',
          input: toolName,
          message: `the wire name "${wireName}" exceeds the ${MAX_WIRE_NAME_LENGTH}-character provider limit`,
          path: ['tools', toolName]
        });
      }
    }
  });
