import { declarePlugin, z } from '@collegium/sdk';

export type $Bookmark = z.infer<typeof $Bookmark>;
export const $Bookmark = z.object({
  url: z.url()
});

export type $BookmarkSettings = z.infer<typeof $BookmarkSettings>;
export const $BookmarkSettings = z
  .object({
    maxBookmarks: z.number().int().positive().default(100)
  })
  .prefault({});

export const plugin = declarePlugin({
  collections: { bookmarks: $Bookmark },
  name: 'bookmark',
  settings: $BookmarkSettings
});
