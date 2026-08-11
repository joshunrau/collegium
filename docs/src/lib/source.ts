import * as path from 'node:path';

import { getCollection } from 'astro:content';
import type { CollectionEntry } from 'astro:content';
import { structure } from 'fumadocs-core/mdx-plugins';
import type { StructuredData } from 'fumadocs-core/mdx-plugins';
import { loader } from 'fumadocs-core/source';
import type { StaticSource } from 'fumadocs-core/source';

/** A renderable docs entry: a file under content/docs, or the spec loaded from SPEC.md. */
type DocEntry = CollectionEntry<'docs'> | CollectionEntry<'spec'>;

/**
 * Bridge Astro's content collections into a Fumadocs source. Each entry keeps a `_raw` handle on
 * its collection entry so a route can `render()` it and the search index can read its body.
 */
async function createSource() {
  const out: StaticSource<{
    metaData: CollectionEntry<'meta'>['data'];
    pageData: CollectionEntry<'docs'>['data'] & {
      _raw: DocEntry;
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

  // The spec has no file under content/docs (content.config.ts loads it from SPEC.md), so its
  // place in the tree is named here.
  for (const page of await getCollection('spec')) {
    out.files.push({
      data: { ...page.data, _raw: page },
      path: 'specification.md',
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

function getStructuredData(entry: DocEntry): StructuredData {
  return structure(entry.body!);
}

export { type DocEntry, getPageImageUrl, getStructuredData, source };
