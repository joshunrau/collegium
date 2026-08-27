import { buildConfigJsonSchema } from '@collegium/config';
import type { APIRoute } from 'astro';

/** the same artifact `pnpm build` writes to packages/config/dist, at a URL an operator's editor can reach without a checkout */
export const GET: APIRoute = () =>
  new Response(`${JSON.stringify(buildConfigJsonSchema(), null, 2)}\n`, {
    headers: { 'content-type': 'application/schema+json' }
  });
