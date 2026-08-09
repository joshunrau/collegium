import type { PluginContext, Tool } from '@collegium/sdk';
import { describe, expect, it } from 'vitest';

import { ListTool } from '../list.tool.ts';
import { SaveTool } from '../save.tool.ts';

function buildContext(maxBookmarks: number): PluginContext {
  const rows = new Map<string, unknown>();
  return {
    settings: { maxBookmarks },
    storage: {
      bookmarks: {
        delete: (key) => Promise.resolve(rows.delete(key)),
        get: (key) => Promise.resolve(rows.get(key) ?? null),
        list: () => Promise.resolve([...rows.entries()].map(([key, value]) => ({ key, value }))),
        put: (key, value) => {
          rows.set(key, value);
          return Promise.resolve();
        }
      }
    }
  };
}

const turn: Tool.TurnScope = {
  agentUsername: 'agent',
  channelId: 'channel',
  discloseMemoryWrite: () => Promise.resolve(),
  triggeringPostId: 'post',
  turnId: 'turn',
  workspaceDir: '/tmp'
};

describe('SaveTool', () => {
  it('is exported under its qualified name', () => {
    expect(SaveTool.prototype.name).toBe('bookmark__save');
  });

  it('saves a bookmark into the collection', async () => {
    const context = buildContext(3);
    const result = await new SaveTool(context).execute({ id: 'docs', url: 'https://example.com' }, turn);
    expect(result.unwrap()).toEqual({ text: 'bookmark docs saved' });
  });

  it('refuses a save beyond the configured limit', async () => {
    const context = buildContext(1);
    const saveTool = new SaveTool(context);
    await saveTool.execute({ id: 'first', url: 'https://example.com' }, turn);
    const result = await saveTool.execute({ id: 'second', url: 'https://example.com' }, turn);
    expect(result.unwrap().text).toContain('limit of 1 reached');
  });

  it('presents the full save in its approval payload', () => {
    const requirements = new SaveTool(buildContext(3)).getApprovalRequirements({
      id: 'docs',
      url: 'https://example.com'
    });
    expect(requirements).toStrictEqual({
      kind: 'gated',
      payload: { body: 'save bookmark "docs" → https://example.com', presentation: 'verbatim' }
    });
  });
});

describe('ListTool', () => {
  it('lists saved bookmarks against the configured limit', async () => {
    const context = buildContext(5);
    await new SaveTool(context).execute({ id: 'docs', url: 'https://example.com' }, turn);
    const result = await new ListTool(context).execute({}, turn);
    expect(result.unwrap().text).toBe('1/5 bookmarks\n- docs: https://example.com');
  });
});
