# @collegium/sdk

The authoring surface for [Collegium](https://collegium.sh) plugins.

A plugin is a directory of TypeScript that default-exports one toolset: a namespace owning tools,
settings, durable storage, and skills. The deployment mounts it, compiles it at boot, and grants it
to the agents that need it. This package is what you write it against.

```sh
npm install @collegium/sdk
```

```ts
import { defineToolset, fail, ok, z } from '@collegium/sdk';

export default defineToolset({
  name: 'contacts',
  settings: z.strictObject({ maxContacts: z.number().int().positive().default(200) }),
  storage: { contacts: z.object({ email: z.email(), name: z.string().min(1) }) },
  tools: {
    find: {
      description: 'Find saved contacts by name.',
      execute: async (args, { storage }) => {
        const matches = (await storage.contacts.list()).filter(({ value }) =>
          value.name.toLowerCase().includes(args.query.toLowerCase())
        );
        return ok(matches.map(({ key, value }) => `- ${key}: ${value.name} <${value.email}>`).join('\n'));
      },
      parameters: z.object({ query: z.string().min(1) }),
      retryable: true
    },
    save: {
      approval: (args) => ({ body: `save contact "${args.id}": ${args.name}`, presentation: 'verbatim' }),
      description: 'Save or update a contact.',
      execute: async (args, { settings, storage }) => {
        if ((await storage.contacts.list()).length >= settings.maxContacts) {
          return fail.invalidArguments('contact limit reached; delete one first');
        }
        await storage.contacts.put(args.id, { email: args.email, name: args.name });
        return ok(`contact ${args.id} saved`);
      },
      parameters: z.object({ email: z.email(), id: z.string().min(1), name: z.string().min(1) })
    }
  }
});
```

A tool with an `approval` always stops for a human, who sees the full payload before it runs; one
without never gates. Both are disclosed line by line in the channel and in the trace.

**This package is a development dependency in practice.** A mounted plugin is compiled against the
SDK the deployment's image carries, not the copy in your `node_modules` — that copy is what your
editor, `tsc`, and your tests use. Import `z` from here rather than installing `zod` yourself; the
compiler refuses any import but this one.

**Versioning.** This package is released with Collegium itself and carries the same version, so the
range you declare names the deployment you are writing for. Boot refuses a plugin whose declared
range the deployment's version does not satisfy. Before v1 any release may break a plugin, so declare
the version you tested against and re-declare it when you update.

Full guide: [collegium.sh/docs/guides/write-a-plugin](https://collegium.sh/docs/guides/write-a-plugin)
