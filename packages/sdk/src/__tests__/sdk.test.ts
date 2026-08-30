import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { defineConfig, defineTool } from '../index.ts';

describe('defineConfig', () => {
  it('normalises the declaration for the load perimeter', () => {
    const config = defineConfig({ settings: z.object({}) });
    expect(config.settings).toBeInstanceOf(z.ZodType);
    expect(config.storage).toStrictEqual({});
  });
});

describe('defineTool', () => {
  it('returns the declaration inert, ready for the load perimeter', () => {
    const tool = defineTool({ description: 'Does something.', execute: () => 'ok', parameters: z.object({}) });
    expect(tool.description).toBe('Does something.');
    expect(tool.parameters).toBeInstanceOf(z.ZodType);
  });
});
