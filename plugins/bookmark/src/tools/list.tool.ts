import { ok, z } from '@collegium/sdk';

import { plugin } from '../plugin.ts';

export const ListTool = plugin.tool({
  description: 'List every saved bookmark.',
  async execute(_args, { settings, storage }) {
    const bookmarks = await storage.bookmarks.list();
    const header = `${bookmarks.length}/${settings.maxBookmarks} bookmarks`;
    const lines = bookmarks.map(({ key, value }) => `- ${key}: ${value.url}`);
    return ok([header, ...lines].join('\n'));
  },
  name: 'list',
  parameters: z.object({}),
  retryable: true
});
