import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { $PluginConfig, $PluginTool } from '../plugins.schemas.ts';

function buildTool() {
  return {
    description: 'Saves a bookmark for later retrieval.',
    execute: () => 'saved',
    parameters: z.object({})
  };
}

describe('$PluginTool', () => {
  it('accepts a tool with every optional declared', () => {
    const tool = {
      ...buildTool(),
      approval: () => ({ body: 'save it', presentation: 'verbatim' }),
      retryable: true,
      timeoutMs: 1000,
      traceDetail: () => 'detail'
    };
    expect($PluginTool.safeParse(tool).success).toBe(true);
  });

  it('rejects a tool without an execute function', () => {
    const { execute: _execute, ...rest } = buildTool();
    expect($PluginTool.safeParse(rest).success).toBe(false);
  });

  it('rejects budgetExempt', () => {
    expect($PluginTool.safeParse({ ...buildTool(), budgetExempt: true }).success).toBe(false);
  });

  it('rejects parameters that are not a Zod type', () => {
    expect($PluginTool.safeParse({ ...buildTool(), parameters: {} }).success).toBe(false);
  });
});

describe('$PluginConfig', () => {
  it('accepts settings and storage', () => {
    const config = { settings: z.object({}), storage: { bookmarks: z.object({ url: z.string() }) } };
    expect($PluginConfig.safeParse(config).success).toBe(true);
  });

  it('accepts an empty declaration', () => {
    expect($PluginConfig.safeParse({}).success).toBe(true);
  });

  it('rejects services', () => {
    expect($PluginConfig.safeParse({ services: {} }).success).toBe(false);
  });

  it('rejects a storage schema that is not a Zod object or declares a stamped field', () => {
    expect($PluginConfig.safeParse({ storage: { bookmarks: {} } }).success).toBe(false);
    expect($PluginConfig.safeParse({ storage: { bookmarks: z.string() } }).success).toBe(false);
    expect($PluginConfig.safeParse({ storage: { bookmarks: z.object({ createdAt: z.date() }) } }).success).toBe(false);
  });

  it('rejects a collection name outside the segment grammar', () => {
    expect($PluginConfig.safeParse({ storage: { 'bad-name': z.object({}) } }).success).toBe(false);
  });
});
