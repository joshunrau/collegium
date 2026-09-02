import { defineTool } from '@collegium/sdk';
import { z } from 'zod';

export default defineTool({
  approval: (args) => ({ body: `save bookmark "${args.id}" → ${args.url}`, presentation: 'verbatim' }),
  description: 'Save a bookmark for later retrieval.',
  execute: async (args, { err, settings, storage }) => {
    if (await storage.bookmarks.findById(args.id)) {
      err.invalidArguments(`bookmark ${args.id} already exists; choose another identifier`);
    }
    const existing = await storage.bookmarks.findMany();
    if (existing.length >= settings.maxBookmarks) {
      err.invalidArguments(`bookmark limit of ${settings.maxBookmarks} reached; delete one first`);
    }
    await storage.bookmarks.create({ id: args.id, url: args.url });
    return `bookmark ${args.id} saved`;
  },
  parameters: z.object({
    id: z.string().min(1).describe('A short identifier to save the bookmark under'),
    url: z.url().describe('The address to bookmark')
  }),
  traceDetail: (args) => `${args.id} → ${args.url}`
});
