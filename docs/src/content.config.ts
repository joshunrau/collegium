import * as fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { glob } from 'astro/loaders';
import { defineCollection } from 'astro:content';
import { z } from 'zod';

import { referenceLoader } from './reference/reference.loader.ts';

import type { ReferencePage, RenderedHtml } from './reference/reference.types.ts';

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

/**
 * Pages that are documents at the repository root, loaded directly rather than copied into the
 * content tree: the site never holds its own copy of the spec or the changelog, so neither can
 * drift. `renderMarkdown` runs the project's markdown pipeline, so the fumadocs plugins supply
 * heading ids and highlighting exactly as they do for the written pages.
 */
const REPOSITORY_DOCUMENTS = [
  {
    description: 'The design axioms and execution model the implementation answers to.',
    id: 'specification',
    path: fileURLToPath(new URL('../../SPEC.md', import.meta.url)),
    title: 'Specification'
  },
  {
    description: 'What each release changed, written from the commits it shipped.',
    id: 'changelog',
    path: fileURLToPath(new URL('../../CHANGELOG.md', import.meta.url)),
    title: 'Changelog'
  }
];

const repository = defineCollection({
  loader: {
    load: async (context) => {
      const sync = async ({ description, id, path: documentPath, title }: (typeof REPOSITORY_DOCUMENTS)[number]) => {
        // A document h1 is dropped: the docs template renders the page title itself.
        const body = (await fs.readFile(documentPath, 'utf8')).replace(/^# .+\n+/, '');
        context.store.set({
          body,
          data: await context.parseData({ data: { description, title }, id }),
          id,
          rendered: await context.renderMarkdown(body)
        });
      };
      await Promise.all(REPOSITORY_DOCUMENTS.map(sync));
      for (const document of REPOSITORY_DOCUMENTS) {
        context.watcher?.add(document.path);
      }
      context.watcher?.on('change', (changed) => {
        const document = REPOSITORY_DOCUMENTS.find(({ path: documentPath }) => documentPath === changed);
        if (document) {
          void sync(document);
        }
      });
    },
    name: 'repository'
  },
  schema: $Frontmatter
});

const reference = defineCollection({
  loader: referenceLoader,
  // The tree is built in-process by the loader; z.custom states that trust rather than restating the type as a schema.
  schema: $Frontmatter.extend({ reference: z.custom<ReferencePage<RenderedHtml>>() })
});

export const collections = {
  docs,
  reference,
  repository
};
