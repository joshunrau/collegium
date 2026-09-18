import { defineTool } from '@collegium/sdk';
import { z } from 'zod';

export default defineTool({
  approval: async (args, { storage }) => {
    const bookmark = await storage.bookmarks.findById(args.id);
    return {
      body: bookmark
        ? `delete bookmark "${args.id}" → ${bookmark.url}`
        : `delete bookmark "${args.id}", which is not saved`,
      presentation: 'verbatim'
    };
  },
  description: 'Delete a saved bookmark.',
  execute: async (args, { err, storage }) => {
    if (!(await storage.bookmarks.deleteById(args.id))) {
      err.invalidArguments(`no bookmark is saved as ${args.id}`);
    }
    return `bookmark ${args.id} deleted`;
  },
  parameters: z.object({
    id: z.string().min(1).describe('The identifier the bookmark was saved under')
  }),
  traceDetail: (args) => args.id
});
