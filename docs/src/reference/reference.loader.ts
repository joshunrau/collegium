import { $Env, $ProvisioningEnv, buildConfigJsonSchema } from '@collegium/config';
import type { Loader } from 'astro/loaders';
import { z } from 'zod';

import { renderSearchMarkdown } from './reference.search.ts';
import { buildFieldTree, mapFieldDescriptions } from './reference.tree.ts';

import type {
  JsonSchemaNode,
  ReferenceLayout,
  ReferencePage,
  ReferenceSection,
  RenderedHtml
} from './reference.types.ts';

type ReferenceSectionSource = {
  readonly heading?: string;
  readonly intro: string;
  readonly schema?: () => JsonSchemaNode;
};

type ReferencePageSource = {
  readonly description: string;
  readonly id: string;
  readonly layout: ReferenceLayout;
  readonly sections: readonly ReferenceSectionSource[];
  readonly title: string;
};

const envJsonSchema = (schema: z.ZodType) =>
  z.toJSONSchema(schema, { io: 'input', target: 'draft-7', unrepresentable: 'any' }) as JsonSchemaNode;

/**
 * The reference pages, each generated from the schemas the app parses its inputs against. Listed
 * in `NAVIGATION` by id like any written page. The tree renders the page; a markdown body of the
 * same rows is what search indexes.
 */
const REFERENCE_PAGES: readonly ReferencePageSource[] = [
  {
    description: 'Every field of config.json, generated from the schema the app boots against.',
    id: 'reference/configuration',
    layout: 'sections',
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
    layout: 'list',
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
          '`.env` also sets `COMPOSE_PROFILES`, `APP_BIND_HOST`, `MATTERMOST_PORT` and `POSTGRES_PASSWORD`, which `docker-compose.yaml` reads and the app never sees: `COMPOSE_PROFILES` decides whether the bundled Mattermost and its database start at all, and `APP_BIND_HOST` is the interface that port is published on, the loopback by default. The `CONFIG_PATH` there is the host-side path Compose mounts into the container.'
      }
    ],
    title: 'Environment'
  }
];

const slugOf = (heading: string) => heading.toLowerCase().replace(/[^a-z0-9]+/g, '-');

function buildSection(source: ReferenceSectionSource): ReferenceSection<string> {
  return {
    fields: source.schema && buildFieldTree(source.schema()),
    heading: source.heading === undefined ? undefined : { id: slugOf(source.heading), text: source.heading },
    intro: source.intro
  };
}

async function renderSection(
  section: ReferenceSection<string>,
  render: (markdown: string) => Promise<RenderedHtml>
): Promise<ReferenceSection<RenderedHtml>> {
  return {
    ...section,
    fields: section.fields && (await mapFieldDescriptions(section.fields, render)),
    intro: await render(section.intro)
  };
}

export const referenceLoader: Loader = {
  load: async (context) => {
    const render = async (markdown: string): Promise<RenderedHtml> => ({
      html: (await context.renderMarkdown(markdown)).html
    });
    for (const source of REFERENCE_PAGES) {
      const page: ReferencePage<string> = { layout: source.layout, sections: source.sections.map(buildSection) };
      const reference: ReferencePage<RenderedHtml> = {
        layout: page.layout,
        sections: await Promise.all(page.sections.map((section) => renderSection(section, render)))
      };
      context.store.set({
        body: renderSearchMarkdown(page),
        data: await context.parseData({
          data: { description: source.description, reference, title: source.title },
          id: source.id
        }),
        id: source.id
      });
    }
  },
  name: 'reference'
};
