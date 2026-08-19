import type { APIRoute } from 'astro';
import { structure } from 'fumadocs-core/mdx-plugins';
import { createFromSource } from 'fumadocs-core/search/server';

import { source } from '@/content.source.ts';

const server = createFromSource(source, {
  buildIndex(page) {
    return {
      description: page.data.description,
      id: page.data._raw.id,
      structuredData: structure(page.data._raw.body!),
      title: page.data.title,
      url: page.url
    };
  }
});

export const GET: APIRoute = () => server.staticGET();
