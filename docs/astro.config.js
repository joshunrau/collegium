import { unified } from '@astrojs/markdown-remark';
import mdx from '@astrojs/mdx';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, fontProviders } from 'astro/config';
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
  fonts: [
    {
      cssVariable: '--font-geist',
      name: 'Geist',
      provider: fontProviders.google(),
      subsets: ['latin'],
      weights: [400, 500, 600]
    },
    {
      cssVariable: '--font-geist-mono',
      name: 'Geist Mono',
      provider: fontProviders.google(),
      subsets: ['latin'],
      weights: [400, 500]
    },
    {
      cssVariable: '--font-newsreader',
      name: 'Newsreader',
      provider: fontProviders.google(),
      subsets: ['latin'],
      weights: [400, 500]
    }
  ],
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
    '/docs': '/docs/introduction/overview'
  },
  server: {
    port: 3000
  },
  site: 'https://collegium.sh',
  vite: {
    plugins: [tailwindcss()],
    // only astro's own vite environment honours these, so `astro dev` syncs content straight from
    // the workspace sources; every build environment falls back to astro's defaults and resolves
    // @collegium/config from its dist, which is why docs is built through turbo rather than by
    // calling `astro build` directly
    resolve: {
      conditions: ['source', 'module', 'browser', 'development|production']
    },
    ssr: {
      resolve: {
        conditions: ['source', 'module', 'node', 'development|production']
      }
    }
  }
});
