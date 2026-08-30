import { defineConfig } from '@collegium/sdk';
import { z } from 'zod';

const config = defineConfig({
  settings: z.strictObject({
    maxBookmarks: z.number().int().positive().default(100)
  }),
  storage: {
    bookmarks: z.object({
      url: z.url()
    })
  }
});

declare module '@collegium/sdk' {
  interface Register {
    config: typeof config;
  }
}

export default config;
