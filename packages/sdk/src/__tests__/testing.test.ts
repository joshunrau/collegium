import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { defineConfig } from '../index.ts';
import { createTestContext, PluginToolFailureError } from '../testing.ts';

const config = defineConfig({
  settings: z.strictObject({ limit: z.number().int().default(3) }),
  storage: { notes: z.object({ body: z.string().min(1), pinned: z.boolean().default(false) }) }
});

describe('createTestContext', () => {
  it('parses settings through the declared schema so defaults apply', () => {
    expect(createTestContext(config).settings).toStrictEqual({ limit: 3 });
    expect(createTestContext(config, { settings: { limit: 5 } }).settings).toStrictEqual({ limit: 5 });
  });

  it('keeps records in memory, stamped and validated on write, in insertion order', async () => {
    const { storage } = createTestContext(config);
    const second = await storage.notes.create({ body: 'second', id: 'b' });
    const first = await storage.notes.create({ body: 'first' });
    expect(second).toMatchObject({ body: 'second', id: 'b', pinned: false });
    expect(first.id).toEqual(expect.any(String));
    expect(await storage.notes.findById('b')).toStrictEqual(second);
    expect(await storage.notes.findMany()).toStrictEqual([second, first]);
    expect(await storage.notes.deleteById('b')).toBe(true);
    expect(await storage.notes.deleteById('b')).toBe(false);
    await expect(storage.notes.create({ body: '' })).rejects.toThrow(z.ZodError);
    await expect(storage.notes.create({ body: 'again', id: first.id })).rejects.toThrow('already holds');
  });

  it('finds by the same grammar the store compiles', async () => {
    const { storage } = createTestContext(config);
    await storage.notes.create({ body: 'Alpha', id: 'a' });
    await storage.notes.create({ body: 'beta', id: 'b' });
    expect(await storage.notes.findMany({ where: { body: { contains: 'ALPHA' } } })).toMatchObject([{ id: 'a' }]);
    expect(await storage.notes.findMany({ limit: 1, where: { id: { in: ['a', 'b'] } } })).toHaveLength(1);
  });

  it('updates by merging the patch and parsing the whole, or returns null', async () => {
    const { storage } = createTestContext(config);
    await storage.notes.create({ body: 'draft', id: 'a' });
    expect(await storage.notes.updateById('a', { pinned: true })).toMatchObject({ body: 'draft', pinned: true });
    await expect(storage.notes.updateById('a', { body: '' })).rejects.toThrow(z.ZodError);
    expect(await storage.notes.updateById('missing', { pinned: true })).toBeNull();
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
