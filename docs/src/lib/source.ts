import * as path from 'node:path';

import { getCollection } from 'astro:content';
import type { CollectionEntry } from 'astro:content';
import { structure } from 'fumadocs-core/mdx-plugins';
import type { StructuredData } from 'fumadocs-core/mdx-plugins';
import { loader } from 'fumadocs-core/source';
import type { StaticSource } from 'fumadocs-core/source';

/**
 * Bridge Astro's content collections into a Fumadocs source. Each entry keeps a `_raw` handle on
 * its collection entry so a route can `render()` it and the search index can read its body.
 */
async function createSource() {
  const out: StaticSource<{
    metaData: CollectionEntry<'meta'>['data'];
    pageData: CollectionEntry<'docs'>['data'] & {
      _raw: CollectionEntry<'docs'>;
    };
  }> = {
    files: []
  };

  for (const page of await getCollection('docs')) {
    out.files.push({
      data: { ...page.data, _raw: page },
      path: path.relative('content/docs', page.filePath!),
      type: 'page'
    });
  }

  for (const meta of await getCollection('meta')) {
    out.files.push({
      data: meta.data,
      path: path.relative('content/docs', meta.filePath!),
      type: 'meta'
    });
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

/** The section index the search server is built from, derived from the raw MDX body. */
function getStructuredData(entry: CollectionEntry<'docs'>): StructuredData {
  return structure(entry.body!);
}

export { getPageImageUrl, getStructuredData, source };
