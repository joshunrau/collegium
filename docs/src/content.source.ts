import * as path from 'node:path';

import { getCollection } from 'astro:content';
import type { CollectionEntry } from 'astro:content';
import { loader } from 'fumadocs-core/source';
import type { StaticSource } from 'fumadocs-core/source';

/** A renderable docs entry: a written page under `content`, a generated reference page, or the spec loaded from SPEC.md. */
type DocEntry = CollectionEntry<'docs'> | CollectionEntry<'reference'> | CollectionEntry<'spec'>;

/**
 * The sidebar, top to bottom: each section's folder with its pages in order, then the root-level
 * pages. Entries are named by page id — `folder/name`, or `name` at the root. Fumadocs shows only
 * what a folder's meta names, so a page absent from this table would be reachable and invisible;
 * building the source refuses instead. A page disabled in its frontmatter stays listed here and is
 * dropped when the tree is built, so it keeps its position.
 */
const NAVIGATION = {
  folders: [
    {
      name: 'introduction',
      pages: ['overview', 'quickstart', 'next-steps'],
      title: 'Introduction'
    },
    {
      name: 'guides',
      pages: ['add-an-agent', 'use-an-existing-mattermost', 'write-a-plugin'],
      title: 'Guides'
    },
    {
      name: 'reference',
      pages: ['configuration', 'environment'],
      title: 'Reference'
    }
  ],
  root: ['specification']
};

/**
 * The published pages, each paired with the path fumadocs derives its slug from. An entry's id is
 * its place in the page tree — the loader already made it relative to the content directory — and
 * is what `NAVIGATION` lists. Disabled pages are left out here, which is the whole of their
 * removal: routes, sidebar, search and OG images are all built from what this returns.
 */
async function collectPages() {
  const written = (await getCollection('docs')).map((entry) => ({
    entry,
    path: `${entry.id}${path.extname(entry.filePath!)}`
  }));
  // Neither the spec nor the reference pages have a file under `content` (content.config.ts
  // generates them), so they have no source extension to read.
  const generated = [...(await getCollection('reference')), ...(await getCollection('spec'))].map((entry) => ({
    entry,
    path: `${entry.id}.md`
  }));

  return [...written, ...generated].filter(({ entry }) => !entry.data.disabled);
}

/** Bridge Astro's content collections into a fumadocs source, ordered and grouped by `NAVIGATION`. */
async function buildSource() {
  const pages = await collectPages();
  const published = new Set(pages.map(({ entry }) => entry.id));

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
  const unplaced = [...published].filter((id) => !navigable.has(id));

  if (unplaced.length > 0) {
    throw new Error(`no place in the sidebar for: ${unplaced.join(', ')}; add them to NAVIGATION`);
  }

  const staticSource: StaticSource<{
    metaData: { pages: string[]; title?: string };
    pageData: CollectionEntry<'docs'>['data'] & {
      /** The collection entry behind the page, so a route can `render()` it and search can read its body. */
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
      ...pages.map(({ entry, path: filePath }) => ({
        data: { ...entry.data, _raw: entry },
        path: filePath,
        type: 'page' as const
      }))
    ]
  };

  return staticSource;
}

const source = loader({
  baseUrl: '/docs',
  source: await buildSource()
});

export { source };
export type { DocEntry };
