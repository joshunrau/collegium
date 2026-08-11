import * as fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { glob } from 'astro/loaders';
import { defineCollection } from 'astro:content';
import { z } from 'zod';

import { CONTENT_DIR } from './content.constants.ts';

const docs = defineCollection({
  loader: glob({ base: `./${CONTENT_DIR}`, pattern: '**/*.{md,mdx}' }),
  schema: z.object({
    description: z.string(),
    title: z.string()
  })
});

/** Sidebar order, which is the only thing a folder's meta.json is used for here. */
const meta = defineCollection({
  loader: glob({ base: `./${CONTENT_DIR}`, pattern: '**/*.json' }),
  schema: z.object({
    pages: z.array(z.string())
  })
});

const specPath = fileURLToPath(new URL('../../SPEC.md', import.meta.url));

/**
 * The specification page is the repository's SPEC.md, loaded directly rather than copied into the
 * content tree: the site never holds its own copy of the spec, so it cannot drift. `renderMarkdown`
 * runs the project's markdown pipeline, so the fumadocs plugins supply heading ids and highlighting
 * exactly as they do for the written pages.
 */
const spec = defineCollection({
  loader: {
    load: async (context) => {
      const sync = async () => {
        // The document h1 is dropped: the docs template renders the page title itself.
        const body = (await fs.readFile(specPath, 'utf8')).replace(/^# .+\n+/, '');
        context.store.set({
          body,
          data: await context.parseData({
            data: {
              description: 'The design axioms and execution model the implementation answers to.',
              title: 'Specification'
            },
            id: 'specification'
          }),
          id: 'specification',
          rendered: await context.renderMarkdown(body)
        });
      };
      await sync();
      context.watcher?.add(specPath);
      context.watcher?.on('change', (changed) => {
        if (changed === specPath) {
          void sync();
        }
      });
    },
    name: 'spec'
  },
  schema: z.object({
    description: z.string(),
    title: z.string()
  })
});

export const collections = {
  docs,
  meta,
  spec
};
