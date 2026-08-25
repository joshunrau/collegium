import { $Env, buildConfigJsonSchema } from '@collegium/config';
import type { Loader } from 'astro/loaders';
import { z } from 'zod';

import { renderJsonSchemaMarkdown } from './reference.utils.ts';

import type { JsonSchemaNode } from './reference.utils.ts';

type ReferencePage = {
  readonly description: string;
  readonly id: string;
  readonly intro: string;
  readonly schema: () => JsonSchemaNode;
  readonly title: string;
};

/**
 * The reference pages, each generated from a schema the app parses its inputs against. Listed in
 * `NAVIGATION` by id like any written page; the body is markdown, so the TOC, search and OG image
 * come from the same pipeline.
 */
const REFERENCE_PAGES: readonly ReferencePage[] = [
  {
    description: 'Every field of config.json, generated from the schema the app boots against.',
    id: 'reference/configuration',
    intro:
      'The schema below is the one the app parses `config.json` against at boot, and the one served at [/config.schema.json](/config.schema.json) — point `$schema` at it for completion in an editor. Fields with a default may be omitted.',
    schema: () => buildConfigJsonSchema(),
    title: 'Configuration'
  },
  {
    description: 'The variables the app reads from its environment.',
    id: 'reference/environment',
    intro:
      'What the app process reads from its environment at boot. Under Compose most of these are set by `docker-compose.yaml` itself; `.env` supplies the rest.',
    schema: () => z.toJSONSchema($Env, { io: 'input', target: 'draft-7', unrepresentable: 'any' }) as JsonSchemaNode,
    title: 'Environment'
  }
];

export const referenceLoader: Loader = {
  load: async (context) => {
    for (const page of REFERENCE_PAGES) {
      const body = `${page.intro}\n\n${renderJsonSchemaMarkdown(page.schema())}`;
      context.store.set({
        body,
        data: await context.parseData({
          data: { description: page.description, title: page.title },
          id: page.id
        }),
        id: page.id,
        rendered: await context.renderMarkdown(body)
      });
    }
  },
  name: 'reference'
};
