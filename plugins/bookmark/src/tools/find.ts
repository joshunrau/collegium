import { defineTool } from '@collegium/sdk';
import { z } from 'zod';

export default defineTool({
  description: 'Find saved bookmarks whose address contains the given text.',
  execute: async (args, { storage }) => {
    const matches = await storage.bookmarks.find({ where: { url: { contains: args.query } } });
    if (matches.length === 0) return 'no bookmarks matched';
    return matches.map(({ key, value }) => `- ${key}: ${value.url}`).join('\n');
  },
  parameters: z.object({
    query: z.string().min(1).describe('Text the bookmarked address must contain, matched without regard to case')
  }),
  retryable: true
});
