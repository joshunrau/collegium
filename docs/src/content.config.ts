import * as fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { glob } from 'astro/loaders';
import { defineCollection } from 'astro:content';
import { z } from 'zod';

import { referenceLoader } from './reference/reference.loader.ts';

/**
 * Where the site's written pages live, relative to the package root. Only the loader needs it: an
 * entry's id is already its path relative to this base, which is what the page tree is built from.
 */
const CONTENT_DIR = 'content';

const $Frontmatter = z.object({
  description: z.string(),
  disabled: z.boolean().default(false),
  title: z.string()
});

const docs = defineCollection({
  loader: glob({ base: `./${CONTENT_DIR}`, pattern: '**/*.{md,mdx}' }),
  schema: $Frontmatter
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
  schema: $Frontmatter
});

const reference = defineCollection({
  loader: referenceLoader,
  schema: $Frontmatter
});

export const collections = {
  docs,
  reference,
  spec
};
