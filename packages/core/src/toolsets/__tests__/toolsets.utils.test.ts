import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { Result } from '../../utils.ts';
import { defineToolset, implementToolset } from '../toolsets.utils.ts';

import type { ToolResult } from '../../tools.ts';
import type { ToolsetDef } from '../toolsets.types.ts';

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

  it('rejects a storage collection that is not an object schema or declares a stamped field', () => {
    expect(() => defineToolset({ name: 'fake', storage: { rows: z.string() as never }, tools: {} })).toThrow(
      'object schema'
    );
    expect(() => defineToolset({ name: 'fake', storage: { rows: z.object({ id: z.string() }) }, tools: {} })).toThrow(
      'may not declare'
    );
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

describe('implementToolset', () => {
  const FAKE_DEF = {
    name: 'fake',
    settings: z.object({ limit: z.number() }),
    tools: ['noop']
  } as const satisfies ToolsetDef;

  it('joins the def and the implementation into one declaration', () => {
    const toolset = implementToolset(FAKE_DEF, { tools: { noop: buildTool() } });
    expect(toolset.name).toBe('fake');
    expect(toolset.settings).toBe(FAKE_DEF.settings);
    expect(Object.keys(toolset.tools)).toStrictEqual(['noop']);
  });

  it('runs the declaration grammar over the def', () => {
    const badNamespace = { name: 'Fake', tools: ['noop'] } as const satisfies ToolsetDef;
    expect(() => implementToolset(badNamespace, { tools: { noop: buildTool() } })).toThrow('toolset namespace');
    const badTool = { name: 'fake', tools: ['no-op'] } as const satisfies ToolsetDef;
    expect(() => implementToolset(badTool, { tools: { 'no-op': buildTool() } })).toThrow('tool name');
  });

  it('runs the declaration grammar over the storage it is handed', () => {
    expect(() => {
      return implementToolset(FAKE_DEF, { storage: { 'bad-name': z.object({}) }, tools: { noop: buildTool() } });
    }).toThrow('storage collection name');
  });
});
