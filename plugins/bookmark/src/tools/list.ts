import { defineTool } from '@collegium/sdk';
import { z } from 'zod';

export default defineTool({
  description: 'List every saved bookmark.',
  execute: async (_args, { settings, storage }) => {
    const bookmarks = await storage.bookmarks.list();
    const header = `${bookmarks.length}/${settings.maxBookmarks} bookmarks`;
    const lines = bookmarks.map(({ key, value }) => `- ${key}: ${value.url}`);
    return [header, ...lines].join('\n');
  },
  parameters: z.object({}),
  retryable: true
});
