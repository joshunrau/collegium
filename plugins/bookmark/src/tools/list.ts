import { defineTool } from '@collegium/sdk';
import { z } from 'zod';

export default defineTool({
  description: 'List every saved bookmark.',
  execute: async (_args, { settings, storage }) => {
    const bookmarks = await storage.bookmarks.findMany();
    const header = `${bookmarks.length}/${settings.maxBookmarks} bookmarks`;
    const lines = bookmarks.map(({ id, url }) => `- ${id}: ${url}`);
    return [header, ...lines].join('\n');
  },
  parameters: z.object({}),
  retryable: true
});
