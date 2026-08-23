import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { Result } from '../../utils.ts';
import { $PluginToolset } from '../plugins.schemas.ts';

import type { ToolResult } from '../../tools.ts';

function buildTool() {
  return {
    description: 'Saves a bookmark for later retrieval.',
    execute: (): ToolResult => Result.ok({ text: 'saved' }),
    parameters: z.object({})
  };
}

describe('$PluginToolset', () => {
  it('accepts a toolset with tools, settings, storage, and a skill', () => {
    const toolset = {
      name: 'bookmark',
      settings: z.object({}),
      skills: ['saving-bookmarks'],
      storage: { bookmarks: z.object({ url: z.string() }) },
      tools: { save: buildTool() }
    };
    expect($PluginToolset.safeParse(toolset).success).toBe(true);
  });

  it('rejects a namespace outside the segment grammar', () => {
    expect($PluginToolset.safeParse({ name: 'book__mark', tools: {} }).success).toBe(false);
  });

  it('rejects a tool name outside the segment grammar', () => {
    expect($PluginToolset.safeParse({ name: 'bookmark', tools: { 'save-it': buildTool() } }).success).toBe(false);
  });

  it('rejects a tool without an execute function', () => {
    const { execute: _execute, ...rest } = buildTool();
    expect($PluginToolset.safeParse({ name: 'bookmark', tools: { save: rest } }).success).toBe(false);
  });

  it('rejects a wire name over the provider limit', () => {
    const tools = { ['a'.repeat(60)]: buildTool() };
    expect($PluginToolset.safeParse({ name: 'bookmark', tools }).success).toBe(false);
  });

  it('rejects budgetExempt on a tool', () => {
    const tools = { save: { ...buildTool(), budgetExempt: true } };
    expect($PluginToolset.safeParse({ name: 'bookmark', tools }).success).toBe(false);
  });

  it('rejects services on the toolset', () => {
    expect($PluginToolset.safeParse({ name: 'bookmark', services: {}, tools: {} }).success).toBe(false);
  });

  it('rejects duplicate skill names', () => {
    expect($PluginToolset.safeParse({ name: 'bookmark', skills: ['a', 'a'], tools: {} }).success).toBe(false);
  });

  it('rejects a storage schema that is not a Zod type', () => {
    expect($PluginToolset.safeParse({ name: 'bookmark', storage: { bookmarks: {} }, tools: {} }).success).toBe(false);
  });
});
