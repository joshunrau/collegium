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
 * The sidebar, top to bottom: each section's folder with its pages in order, then the root-level
 * pages. Fumadocs shows only what a folder's meta names, so a page absent from this structure
 * would be reachable and invisible — `createSource` refuses instead.
 */
const NAVIGATION = {
  folders: [
    {
      name: 'getting-started',
      pages: ['introduction', 'quickstart', 'next-steps'],
      title: 'Getting Started'
    },
    {
      name: 'guides',
      pages: ['add-an-agent', 'write-a-plugin'],
      title: 'Guides'
    },
    {
      name: 'concepts',
      pages: [
        'design-overview',
        'agents-and-identity',
        'turns-and-activation',
        'tools-skills-and-memory',
        'the-approval-gate',
        'safety-and-confinement',
        'execution-and-failure',
        'observability'
      ],
      title: 'Concepts'
    }
  ],
  root: ['specification']
};

/**
 * Bridge Astro's content collections into a Fumadocs source. Each entry keeps a `_raw` handle on
 * its collection entry so a route can `render()` it and the search index can read its body.
 */
async function createSource() {
  const out: StaticSource<{
    metaData: { pages: string[]; title?: string };
    pageData: CollectionEntry<'docs'>['data'] & {
      _raw: DocEntry;
    };
  }> = {
    files: [
      {
        data: { pages: [...NAVIGATION.folders.map((folder) => folder.name), ...NAVIGATION.root] },
        path: 'meta.json',
        type: 'meta'
      },
      ...NAVIGATION.folders.map((folder) => ({
        data: { pages: folder.pages, title: folder.title },
        path: `${folder.name}/meta.json`,
        type: 'meta' as const
      }))
    ]
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
    .map((file) => path.parse(file.path))
    .filter(({ dir, name }) => {
      const pages = dir === '' ? NAVIGATION.root : NAVIGATION.folders.find((folder) => folder.name === dir)?.pages;
      return !pages?.includes(name);
    })
    .map(({ dir, name }) => (dir === '' ? name : `${dir}/${name}`));

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
