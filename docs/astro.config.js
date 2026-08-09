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
  site: 'https://collegium.sh',
  vite: {
    plugins: [tailwindcss()]
  }
});
