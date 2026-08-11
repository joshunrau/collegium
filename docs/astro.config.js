// @ts-check

import { unified } from '@astrojs/markdown-remark';
import mdx from '@astrojs/mdx';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';
import { rehypeCode, remarkCodeTab, remarkHeading, remarkNpm, remarkStructure } from 'fumadocs-core/mdx-plugins';

// Fumadocs owns the pipeline: remarkHeading supplies the heading ids the TOC anchors to,
// remarkStructure the section index search is built from, and rehypeCode the highlighting
// Astro's own shiki pass is turned off for.
/** @type {import('@astrojs/markdown-remark').RemarkPlugins} */
const remarkPlugins = [remarkHeading, remarkCodeTab, remarkNpm, [remarkStructure, { exportAs: 'structuredData' }]];

/** @type {import('@astrojs/markdown-remark').RehypePlugins} */
const rehypePlugins = [rehypeCode];

export default defineConfig({
  build: {
    assets: '_assets'
  },
  compressHTML: true,
  integrations: [
    react(),
    mdx({
      extendMarkdownConfig: true,
      syntaxHighlight: false
    })
  ],
  markdown: {
    processor: unified({
      rehypePlugins,
      remarkPlugins
    }),
    syntaxHighlight: false
  },
  output: 'static',
  // there is no page at the docs root; the section starts where a reader would start
  redirects: {
    '/docs': '/docs/getting-started'
  },
  server: {
    port: 3000
  },
  site: 'https://collegium.sh',
  vite: {
    plugins: [tailwindcss()]
  }
});
