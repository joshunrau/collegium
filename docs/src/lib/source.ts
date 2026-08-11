import * as path from 'node:path';

import { getCollection } from 'astro:content';
import type { CollectionEntry } from 'astro:content';
import { structure } from 'fumadocs-core/mdx-plugins';
import type { StructuredData } from 'fumadocs-core/mdx-plugins';
import { loader } from 'fumadocs-core/source';
import type { StaticSource } from 'fumadocs-core/source';

import { CONTENT_DIR } from '@/content.constants.ts';

/** A renderable docs entry: a written page under `content`, or the spec loaded from SPEC.md. */
type DocEntry = CollectionEntry<'docs'> | CollectionEntry<'spec'>;

/**
 * The sidebar, top to bottom, by page name. Fumadocs shows only what a folder's meta names, so a
 * page absent from this list would be reachable and invisible — `createSource` refuses instead.
 */
const NAVIGATION = ['getting-started', 'specification'];

/**
 * Bridge Astro's content collections into a Fumadocs source. Each entry keeps a `_raw` handle on
 * its collection entry so a route can `render()` it and the search index can read its body.
 */
async function createSource() {
  const out: StaticSource<{
    metaData: { pages: string[] };
    pageData: CollectionEntry<'docs'>['data'] & {
      _raw: DocEntry;
    };
  }> = {
    files: [{ data: { pages: NAVIGATION }, path: 'meta.json', type: 'meta' }]
  };

  for (const page of await getCollection('docs')) {
    out.files.push({
      data: { ...page.data, _raw: page },
      path: path.relative(CONTENT_DIR, page.filePath!),
      type: 'page'
    });
  }

  // The spec has no file under `content` (content.config.ts loads it from SPEC.md), so its place
  // in the tree is named here.
  for (const page of await getCollection('spec')) {
    out.files.push({
      data: { ...page.data, _raw: page },
      path: 'specification.md',
      type: 'page'
    });
  }

  const unnavigable = out.files
    .filter((file) => file.type === 'page')
    .map((file) => path.parse(file.path).name)
    .filter((name) => !NAVIGATION.includes(name));

  if (unnavigable.length > 0) {
    throw new Error(`no place in the sidebar for: ${unnavigable.join(', ')}; add them to NAVIGATION`);
  }

  return out;
}

const source = loader({
  baseUrl: '/docs',
  source: await createSource()
});

function getPageImageUrl(page: (typeof source)['$inferPage']) {
  return '/' + ['og', 'docs', ...page.slugs, 'image.webp'].join('/');
}

function getStructuredData(entry: DocEntry): StructuredData {
  return structure(entry.body!);
}

export { type DocEntry, getPageImageUrl, getStructuredData, source };
