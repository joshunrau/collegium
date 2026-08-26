import { $Env, $ProvisioningEnv, buildConfigJsonSchema } from '@collegium/config';
import type { Loader } from 'astro/loaders';
import { z } from 'zod';

import { renderJsonSchemaMarkdown } from './reference.utils.ts';

import type { JsonSchemaNode } from './reference.utils.ts';

type ReferenceSection = {
  readonly heading?: string;
  readonly intro: string;
  readonly schema?: () => JsonSchemaNode;
};

type ReferencePage = {
  readonly description: string;
  readonly id: string;
  readonly sections: readonly ReferenceSection[];
  readonly title: string;
};

const envJsonSchema = (schema: z.ZodType) =>
  z.toJSONSchema(schema, { io: 'input', target: 'draft-7', unrepresentable: 'any' }) as JsonSchemaNode;

/**
 * The reference pages, each generated from the schemas the app parses its inputs against. Listed
 * in `NAVIGATION` by id like any written page; the body is markdown, so the TOC, search and OG
 * image come from the same pipeline.
 */
const REFERENCE_PAGES: readonly ReferencePage[] = [
  {
    description: 'Every field of config.json, generated from the schema the app boots against.',
    id: 'reference/configuration',
    sections: [
      {
        intro:
          'The schema below is the one the app parses `config.json` against at boot, and the one served at [/config.schema.json](/config.schema.json) — point `$schema` at it for completion in an editor. Fields with a default may be omitted.',
        schema: () => buildConfigJsonSchema()
      }
    ],
    title: 'Configuration'
  },
  {
    description: 'The variables the app and its provisioning read from the environment.',
    id: 'reference/environment',
    sections: [
      {
        intro:
          'What the app process reads from its environment at boot. Under Compose most of these are set by `docker-compose.yaml` itself; `.env` supplies the rest.',
        schema: () => envJsonSchema($Env)
      },
      {
        heading: 'Provisioning',
        intro:
          'The administrator provisioning signs in as. These reach the provisioning subprocess and no further: the container entrypoint drops them from the environment before the app itself is imported.',
        schema: () => envJsonSchema($ProvisioningEnv)
      },
      {
        heading: 'Compose only',
        intro:
          '`.env` also sets `MATTERMOST_PORT` and `POSTGRES_PASSWORD`, which `docker-compose.yaml` reads and the app never sees; the `CONFIG_PATH` there is the host-side path Compose mounts into the container, and `APP_PORT` is the port the app binds inside the Compose network, published to nothing.'
      }
    ],
    title: 'Environment'
  }
];

function renderSection(section: ReferenceSection): string {
  return [
    section.heading === undefined ? undefined : `## ${section.heading}`,
    section.intro,
    section.schema === undefined ? undefined : renderJsonSchemaMarkdown(section.schema())
  ]
    .filter((part) => part !== undefined)
    .join('\n\n');
}

export const referenceLoader: Loader = {
  load: async (context) => {
    for (const page of REFERENCE_PAGES) {
      const body = page.sections.map(renderSection).join('\n\n');
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
