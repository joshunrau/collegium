import type { ToolsetCollection, ToolTurnScope } from '@collegium/sdk';
import { describe, expect, it } from 'vitest';

import bookmarkToolset, { $BookmarkSettings } from '../index.ts';

import type { $Bookmark } from '../index.ts';

const TURN: ToolTurnScope = {
  agentUsername: 'mira',
  channelId: 'channel-1',
  triggeringPostId: 'post-1',
  turnId: 'turn-1'
};

function buildContext(rows: { key: string; value: $Bookmark }[]) {
  const bookmarks: ToolsetCollection<$Bookmark> = {
    delete: (key) => {
      const index = rows.findIndex((row) => row.key === key);
      if (index === -1) {
        return Promise.resolve(false);
      }
      rows.splice(index, 1);
      return Promise.resolve(true);
    },
    get: (key) => Promise.resolve(rows.find((row) => row.key === key)?.value ?? null),
    list: () => Promise.resolve([...rows]),
    put: (key, value) => {
      rows.push({ key, value });
      return Promise.resolve();
    }
  };
  return { settings: $BookmarkSettings.parse({ maxBookmarks: 2 }), storage: { bookmarks }, turn: TURN };
}

const { list, save } = bookmarkToolset.tools;

describe('bookmark toolset', () => {
  it('saves a bookmark and lists it back', async () => {
    const rows: { key: string; value: $Bookmark }[] = [];
    const context = buildContext(rows);
    const saved = await save.execute({ id: 'docs', url: 'https://example.org/docs' }, context);
    expect(saved.unwrap().text).toBe('bookmark docs saved');
    const listed = await list.execute({}, context);
    expect(listed.unwrap().text).toBe('1/2 bookmarks\n- docs: https://example.org/docs');
  });

  it('refuses a save past the settings limit', async () => {
    const context = buildContext([
      { key: 'a', value: { url: 'https://example.org/a' } },
      { key: 'b', value: { url: 'https://example.org/b' } }
    ]);
    const result = await save.execute({ id: 'c', url: 'https://example.org/c' }, context);
    expect(result.error).toStrictEqual({
      kind: 'invalid-arguments',
      message: 'bookmark limit of 2 reached; delete one first'
    });
  });

  it('gates only the save, presenting exactly what will be written', () => {
    const payload = save.approval?.({ id: 'docs', url: 'https://example.org/docs' });
    expect(payload).toStrictEqual({
      body: 'save bookmark "docs" → https://example.org/docs',
      presentation: 'verbatim'
    });
    expect('approval' in list).toBe(false);
  });
});
