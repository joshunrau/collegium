import { ok, z } from '@collegium/sdk';

import { plugin } from '../plugin.ts';

export const SaveTool = plugin.tool({
  approval: (args) => ({ body: `save bookmark "${args.id}" → ${args.url}`, presentation: 'verbatim' }),
  description: 'Save a bookmark for later retrieval.',
  async execute(args, { settings, storage }) {
    const existing = await storage.bookmarks.list();
    if (existing.length >= settings.maxBookmarks) {
      return ok(`bookmark limit of ${settings.maxBookmarks} reached; delete one first`);
    }
    await storage.bookmarks.put(args.id, { url: args.url });
    return ok(`bookmark ${args.id} saved`);
  },
  name: 'save',
  parameters: z.object({
    id: z.string().min(1).describe('A short identifier to save the bookmark under'),
    url: z.url().describe('The address to bookmark')
  }),
  traceDetail: (args) => `${args.id} → ${args.url}`
});
