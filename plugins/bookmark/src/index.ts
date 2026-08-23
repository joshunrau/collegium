import { defineToolset, fail, ok, z } from '@collegium/sdk';

export type $Bookmark = z.infer<typeof $Bookmark>;
export const $Bookmark = z.object({
  url: z.url()
});

export type $BookmarkSettings = z.infer<typeof $BookmarkSettings>;
export const $BookmarkSettings = z.strictObject({
  maxBookmarks: z.number().int().positive().default(100)
});

export default defineToolset({
  name: 'bookmark',
  settings: $BookmarkSettings,
  skills: ['saving-bookmarks'],
  storage: { bookmarks: $Bookmark },
  tools: {
    list: {
      description: 'List every saved bookmark.',
      execute: async (_args, { settings, storage }) => {
        const bookmarks = await storage.bookmarks.list();
        const header = `${bookmarks.length}/${settings.maxBookmarks} bookmarks`;
        const lines = bookmarks.map(({ key, value }) => `- ${key}: ${value.url}`);
        return ok([header, ...lines].join('\n'));
      },
      parameters: z.object({}),
      retryable: true
    },
    save: {
      approval: (args) => ({ body: `save bookmark "${args.id}" → ${args.url}`, presentation: 'verbatim' }),
      description: 'Save a bookmark for later retrieval.',
      execute: async (args, { settings, storage }) => {
        const existing = await storage.bookmarks.list();
        if (existing.length >= settings.maxBookmarks) {
          return fail.invalidArguments(`bookmark limit of ${settings.maxBookmarks} reached; delete one first`);
        }
        await storage.bookmarks.put(args.id, { url: args.url });
        return ok(`bookmark ${args.id} saved`);
      },
      parameters: z.object({
        id: z.string().min(1).describe('A short identifier to save the bookmark under'),
        url: z.url().describe('The address to bookmark')
      }),
      traceDetail: (args) => `${args.id} → ${args.url}`
    }
  }
});
