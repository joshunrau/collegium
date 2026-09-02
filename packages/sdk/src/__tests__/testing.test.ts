import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { defineConfig } from '../index.ts';
import { createTestContext, PluginToolFailureError } from '../testing.ts';

const config = defineConfig({
  settings: z.strictObject({ limit: z.number().int().default(3) }),
  storage: { notes: z.object({ body: z.string().min(1) }) }
});

describe('createTestContext', () => {
  it('parses settings through the declared schema so defaults apply', () => {
    expect(createTestContext(config).settings).toStrictEqual({ limit: 3 });
    expect(createTestContext(config, { settings: { limit: 5 } }).settings).toStrictEqual({ limit: 5 });
  });

  it('keeps storage in memory, validated on write and listed in insertion order', async () => {
    const { storage } = createTestContext(config);
    await storage.notes.put('b', { body: 'second' });
    await storage.notes.put('a', { body: 'first' });
    expect(await storage.notes.get('a')).toStrictEqual({ body: 'first' });
    expect(await storage.notes.list()).toStrictEqual([
      { key: 'b', value: { body: 'second' } },
      { key: 'a', value: { body: 'first' } }
    ]);
    expect(await storage.notes.delete('b')).toBe(true);
    expect(await storage.notes.delete('b')).toBe(false);
    await expect(storage.notes.put('c', { body: '' })).rejects.toThrow(z.ZodError);
  });

  it('raises the failure the framework wrapper catches', () => {
    const { err } = createTestContext(config);
    expect(() => err.invalidArguments('rejected')).toThrow(PluginToolFailureError);
  });

  it('omits settings when the config declares none and accepts turn overrides', () => {
    const context = createTestContext(defineConfig({}), { turn: { agentUsername: 'mira' } });
    expect('settings' in context).toBe(false);
    expect(context.turn).toMatchObject({ agentUsername: 'mira', triggeringPostId: null });
  });
});
