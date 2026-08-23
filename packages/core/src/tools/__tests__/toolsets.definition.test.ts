import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { Result } from '../../utils.ts';
import { defineToolset } from '../toolsets.definition.ts';

import type { ToolResult } from '../toolsets.definition.ts';

function buildTool() {
  return {
    description: 'Does nothing.',
    execute: (): ToolResult => Result.ok({ text: 'done' }),
    parameters: z.object({})
  };
}

describe('defineToolset', () => {
  it('returns the declaration unchanged', () => {
    const declaration = { name: 'fake', tools: { noop: buildTool() } };
    expect(defineToolset(declaration)).toBe(declaration);
  });

  it('rejects a namespace outside the segment grammar', () => {
    expect(() => defineToolset({ name: 'Fake', tools: {} })).toThrow('toolset namespace');
    expect(() => defineToolset({ name: 'fa__ke', tools: {} })).toThrow('toolset namespace');
  });

  it('rejects a tool name outside the segment grammar', () => {
    expect(() => defineToolset({ name: 'fake', tools: { 'no-op': buildTool() } })).toThrow('tool name');
  });

  it('rejects a wire name over the provider limit', () => {
    const toolName = 'a'.repeat(63);
    expect(() => defineToolset({ name: 'fake', tools: { [toolName]: buildTool() } })).toThrow('provider limit');
  });

  it('rejects a storage collection name outside the segment grammar', () => {
    expect(() => defineToolset({ name: 'fake', storage: { 'bad-name': z.object({}) }, tools: {} })).toThrow(
      'storage collection name'
    );
  });

  it('rejects a skill name outside the dashed grammar', () => {
    expect(() => defineToolset({ name: 'fake', skills: ['bad_name'], tools: {} })).toThrow('skill name');
  });
});
