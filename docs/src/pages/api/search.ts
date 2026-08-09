import type { APIRoute } from 'astro';
import { createFromSource } from 'fumadocs-core/search/server';

import { getStructuredData, source } from '@/lib/source';

const server = createFromSource(source, {
  buildIndex(page) {
    return {
      description: page.data.description,
      id: page.data._raw.id,
      structuredData: getStructuredData(page.data._raw),
      title: page.data.title,
      url: page.url
    };
  }
});

export const GET: APIRoute = () => server.staticGET();
