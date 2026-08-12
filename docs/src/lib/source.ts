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
 * would be reachable and invisible — `createSource` refuses instead. A page disabled in its
 * frontmatter stays listed here and is dropped when the tree is built, so it keeps its position.
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

/** A page's place in `NAVIGATION`, as its meta lists spell it: `folder/name`, or `name` at the root. */
function toNavigationKey(filePath: string) {
  const { dir, name } = path.parse(filePath);
  return dir === '' ? name : `${dir}/${name}`;
}

/**
 * Bridge Astro's content collections into a Fumadocs source. Each entry keeps a `_raw` handle on
 * its collection entry so a route can `render()` it and the search index can read its body.
 * Disabled pages are left out here, which is the whole of their removal: routes, sidebar, search
 * and OG images are all built from what this returns.
 */
async function createSource() {
  const entries = [
    ...(await getCollection('docs')).map((entry) => ({
      entry,
      path: path.relative(CONTENT_DIR, entry.filePath!)
    })),
    // The spec has no file under `content` (content.config.ts loads it from SPEC.md), so its place
    // in the tree is named here.
    ...(await getCollection('spec')).map((entry) => ({ entry, path: 'specification.md' }))
  ].filter(({ entry }) => !entry.data.disabled);

  const published = new Set(entries.map(({ path: filePath }) => toNavigationKey(filePath)));

  const folders = NAVIGATION.folders
    .map((folder) => ({
      ...folder,
      pages: folder.pages.filter((page) => published.has(`${folder.name}/${page}`))
    }))
    .filter((folder) => folder.pages.length > 0);
  const root = NAVIGATION.root.filter((page) => published.has(page));

  const navigable = new Set([
    ...NAVIGATION.root,
    ...NAVIGATION.folders.flatMap((folder) => folder.pages.map((page) => `${folder.name}/${page}`))
  ]);
  const unnavigable = [...published].filter((key) => !navigable.has(key));

  if (unnavigable.length > 0) {
    throw new Error(`no place in the sidebar for: ${unnavigable.join(', ')}; add them to NAVIGATION`);
  }

  const out: StaticSource<{
    metaData: { pages: string[]; title?: string };
    pageData: CollectionEntry<'docs'>['data'] & {
      _raw: DocEntry;
    };
  }> = {
    files: [
      {
        data: { pages: [...folders.map((folder) => folder.name), ...root] },
        path: 'meta.json',
        type: 'meta'
      },
      ...folders.map((folder) => ({
        data: { pages: folder.pages, title: folder.title },
        path: `${folder.name}/meta.json`,
        type: 'meta' as const
      })),
      ...entries.map(({ entry, path: filePath }) => ({
        data: { ...entry.data, _raw: entry },
        path: filePath,
        type: 'page' as const
      }))
    ]
  };

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
