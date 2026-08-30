import { defineTool } from '@collegium/sdk';
import { z } from 'zod';

export default defineTool({
  approval: (args) => ({ body: `save bookmark "${args.id}" → ${args.url}`, presentation: 'verbatim' }),
  description: 'Save a bookmark for later retrieval.',
  execute: async (args, { err, settings, storage }) => {
    const existing = await storage.bookmarks.list();
    if (existing.length >= settings.maxBookmarks) {
      err.invalidArguments(`bookmark limit of ${settings.maxBookmarks} reached; delete one first`);
    }
    await storage.bookmarks.put(args.id, { url: args.url });
    return `bookmark ${args.id} saved`;
  },
  parameters: z.object({
    id: z.string().min(1).describe('A short identifier to save the bookmark under'),
    url: z.url().describe('The address to bookmark')
  }),
  traceDetail: (args) => `${args.id} → ${args.url}`
});
