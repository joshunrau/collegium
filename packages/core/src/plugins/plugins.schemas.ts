import { isFunction } from 'es-toolkit';
import { z } from 'zod';

import { TOOL_CONSTRUCTOR_SYMBOL } from '../tools.ts';
import { isUnique } from '../utils.ts';
import {
  MAX_TOOL_NAME_LENGTH,
  PLUGIN_NAME_PATTERN,
  PLUGIN_NAME_SEPARATOR,
  PLUGIN_SKILL_NAME_PATTERN,
  PLUGIN_TOOL_NAME_PATTERN,
  QUALIFIED_SKILL_NAME_PATTERN,
  QUALIFIED_TOOL_NAME_PATTERN
} from './plugins.constants.ts';

import type { PluginQualifiedName, PluginToolConstructor } from './plugins.types.ts';

const $ToolConstructor = z.custom<PluginToolConstructor>((arg) => {
  if (!isFunction(arg)) {
    return false;
  }
  return Reflect.get(arg, TOOL_CONSTRUCTOR_SYMBOL) === true;
});

const $ZodSchema = z.custom<z.ZodType>((arg) => arg instanceof z.ZodType);

export type $QualifiedToolName = z.infer<typeof $QualifiedToolName>;
/** a type-only narrowing: the runtime schema is the plain regex-checked string, presented as the qualified template type */
export const $QualifiedToolName = z.string().regex(QUALIFIED_TOOL_NAME_PATTERN) as unknown as z.ZodType<
  PluginQualifiedName<string, string>,
  PluginQualifiedName<string, string>
>;

export type $QualifiedSkillName = z.infer<typeof $QualifiedSkillName>;
export const $QualifiedSkillName = z.string().regex(QUALIFIED_SKILL_NAME_PATTERN) as unknown as z.ZodType<
  PluginQualifiedName<string, string>,
  PluginQualifiedName<string, string>
>;

export type $Plugin = z.infer<typeof $Plugin>;
export const $Plugin = z
  .object({
    collections: z.record(z.string().regex(PLUGIN_NAME_PATTERN), $ZodSchema).optional(),
    name: z.string().min(1).regex(PLUGIN_NAME_PATTERN),
    settings: $ZodSchema.optional(),
    skills: z.array(z.string().regex(PLUGIN_SKILL_NAME_PATTERN)).default([]),
    tools: z.array($ToolConstructor).default([])
  })
  .check((ctx) => {
    const { name, skills, tools } = ctx.value;

    if (!isUnique(skills)) {
      ctx.issues.push({ code: 'custom', input: skills, message: 'skill names must be unique', path: ['skills'] });
    }

    const qualifiedPrefix = `${name}${PLUGIN_NAME_SEPARATOR}`;
    const uniqueToolNames = new Set<string>();
    for (const [index, tool] of tools.entries()) {
      const toolName = tool.prototype.name;
      const bareName = toolName.slice(qualifiedPrefix.length);
      if (!toolName.startsWith(qualifiedPrefix) || !PLUGIN_TOOL_NAME_PATTERN.test(bareName)) {
        ctx.issues.push({
          code: 'custom',
          input: toolName,
          message: `tool name must be "${qualifiedPrefix}<tool>" with the bare name in the tool name grammar — a tool declared through another plugin's factory is not this plugin's to export`,
          path: ['tools', index, 'config', 'name']
        });
      }
      if (uniqueToolNames.has(toolName)) {
        ctx.issues.push({
          code: 'custom',
          input: toolName,
          message: 'tool names must be unique',
          path: ['tools', index, 'config', 'name']
        });
      }
      if (toolName.length > MAX_TOOL_NAME_LENGTH) {
        ctx.issues.push({
          code: 'custom',
          input: toolName,
          message: `tool names (including qualifier) must not exceed ${MAX_TOOL_NAME_LENGTH} characters`,
          path: ['tools', index, 'config', 'name']
        });
      }
      uniqueToolNames.add(toolName);
    }
  });
