import { $Plugin } from '@collegium/core/plugins';
import type { PluginContext } from '@collegium/core/plugins';
import type { Tool } from '@collegium/core/tools';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { declarePlugin } from '../plugin.factory.ts';
import { ok } from '../tool.utils.ts';

const plugin = declarePlugin({
  collections: { bookmarks: z.object({ url: z.string() }) },
  name: 'bookmark',
  settings: z.object({ maxBookmarks: z.number() })
});

const SaveTool = plugin.tool({
  approval: (args) => (args.gate ? { body: 'save it', presentation: 'verbatim' } : null),
  description: 'Saves a bookmark.',
  async execute(_args, { settings, storage, turn }) {
    await storage.bookmarks.put('a', { url: 'https://example.com' });
    return ok(`limit ${settings.maxBookmarks} for ${turn.agentUsername}`);
  },
  name: 'save',
  parameters: z.object({ gate: z.boolean() })
});

const turn: Tool.TurnScope = {
  agentUsername: 'mira',
  channelId: 'channel',
  discloseMemoryWrite: () => Promise.resolve(),
  triggeringPostId: 'post',
  turnId: 'turn',
  workspaceDir: '/tmp'
};

function buildContext() {
  const written: unknown[] = [];
  const context: PluginContext = {
    settings: { maxBookmarks: 3 },
    storage: {
      bookmarks: {
        delete: () => Promise.resolve(true),
        get: () => Promise.resolve(null),
        list: () => Promise.resolve([]),
        put: (key, value) => {
          written.push([key, value]);
          return Promise.resolve();
        }
      }
    }
  };
  return { context, written };
}

describe('declarePlugin', () => {
  it('bakes the qualified name at definition', () => {
    const { context } = buildContext();
    expect(new SaveTool(context).name).toBe('bookmark__save');
    expect(SaveTool.prototype.name).toBe('bookmark__save');
  });

  it('hands the tool body its context and the turn', async () => {
    const { context, written } = buildContext();
    const result = await new SaveTool(context).execute({ gate: false }, turn);
    expect(result.unwrap()).toEqual({ text: 'limit 3 for mira' });
    expect(written).toEqual([['a', { url: 'https://example.com' }]]);
  });

  it('resolves the gate per call through the approval function', () => {
    const { context } = buildContext();
    const saveTool = new SaveTool(context);
    expect(saveTool.getApprovalRequirements({ gate: false })).toStrictEqual({ kind: 'ungated' });
    expect(saveTool.getApprovalRequirements({ gate: true })).toStrictEqual({
      kind: 'gated',
      payload: { body: 'save it', presentation: 'verbatim' }
    });
  });

  it('never gates a tool that declares no approval', () => {
    const readTool = plugin.tool({
      description: 'Reads.',
      execute: () => ok('read'),
      name: 'read',
      parameters: z.object({})
    });
    const { context } = buildContext();
    const instance = new readTool(context);
    expect(instance.variant).toBe('ungated');
    expect(instance.getApprovalRequirements({})).toStrictEqual({ kind: 'ungated' });
  });

  it('defaults timeout, retryability, and trace detail', () => {
    const { context } = buildContext();
    const saveTool = new SaveTool(context);
    expect(saveTool.timeoutMs).toBe(5000);
    expect(saveTool.isRetryable({ gate: false })).toBe(false);
    expect(saveTool.renderTraceDetail({ gate: false })).toBe('');
  });

  it('creates a manifest the framework accepts', () => {
    const manifest = plugin.create({ skills: ['saving-bookmarks'], tools: [SaveTool] });
    expect($Plugin.safeParse(manifest).success).toBe(true);
  });

  it('rejects a tool declared through another plugin’s factory', () => {
    const other = declarePlugin({ name: 'other' });
    expect($Plugin.safeParse(other.create({ tools: [SaveTool] })).success).toBe(false);
  });
});
