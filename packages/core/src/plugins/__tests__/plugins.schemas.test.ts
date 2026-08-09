import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { Tool } from '../../tools.ts';
import { Result } from '../../utils.ts';
import { $Plugin } from '../plugins.schemas.ts';

function buildTool(name: string) {
  return class extends Tool({
    description: 'Saves a bookmark for later retrieval.',
    name,
    parameters: z.object({}),
    timeoutMs: 1000,
    variant: 'ungated'
  }) {
    execute(): Tool.Result {
      return Result.ok({ text: 'saved' });
    }

    getApprovalRequirements(): Tool.ApprovalRequirements.Ungated {
      return { kind: 'ungated' };
    }

    isRetryable(): boolean {
      return true;
    }

    renderTraceDetail(): string {
      return name;
    }
  };
}

describe('$Plugin', () => {
  it('accepts a plugin with a qualified tool, a collection, settings, and a skill', () => {
    const plugin = {
      collections: { bookmarks: z.object({ url: z.string() }) },
      name: 'bookmark',
      settings: z.object({}),
      skills: ['saving-bookmarks'],
      tools: [buildTool('bookmark__save')]
    };
    expect($Plugin.safeParse(plugin).success).toBe(true);
  });

  it('rejects a value that is not a tool constructor', () => {
    expect($Plugin.safeParse({ name: 'bookmark', tools: [() => null] }).success).toBe(false);
  });

  it('rejects a tool not qualified by this plugin', () => {
    expect($Plugin.safeParse({ name: 'bookmark', tools: [buildTool('other__save')] }).success).toBe(false);
    expect($Plugin.safeParse({ name: 'bookmark', tools: [buildTool('save')] }).success).toBe(false);
  });

  it('rejects duplicate tool names', () => {
    const tools = [buildTool('bookmark__save'), buildTool('bookmark__save')];
    expect($Plugin.safeParse({ name: 'bookmark', tools }).success).toBe(false);
  });

  it('rejects a qualified tool name longer than the provider limit', () => {
    expect($Plugin.safeParse({ name: 'bookmark', tools: [buildTool(`bookmark__${'a'.repeat(60)}`)] }).success).toBe(
      false
    );
  });

  it('rejects duplicate skill names', () => {
    expect($Plugin.safeParse({ name: 'bookmark', skills: ['a', 'a'], tools: [] }).success).toBe(false);
  });

  it('rejects a collection whose schema is not a Zod type', () => {
    expect($Plugin.safeParse({ collections: { bookmarks: {} }, name: 'bookmark', tools: [] }).success).toBe(false);
  });
});
