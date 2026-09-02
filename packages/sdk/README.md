# @collegium/sdk

The authoring surface for [Collegium](https://collegium.sh) plugins.

A plugin is a directory of TypeScript. The deployment mounts it, compiles it at boot, and grants it to the agents that need it. The layout declares the contents: `src/config.ts` declares settings and storage, each `src/tools/<name>.ts` declares one tool named by its filename, and each `src/skills/<name>.md` ships one skill.

```sh
npm install @collegium/sdk zod
```

`src/config.ts`:

```ts
import { defineConfig } from '@collegium/sdk';
import { z } from 'zod';

const config = defineConfig({
  settings: z.strictObject({ maxContacts: z.number().int().positive().default(200) }),
  storage: { contacts: z.object({ email: z.email(), name: z.string().min(1) }) }
});

declare module '@collegium/sdk' {
  interface Register {
    config: typeof config;
  }
}

export default config;
```

`src/tools/save.ts`:

```ts
import { defineTool } from '@collegium/sdk';
import { z } from 'zod';

export default defineTool({
  approval: (args) => ({ body: `save contact "${args.id}": ${args.name}`, presentation: 'verbatim' }),
  description: 'Save or update a contact.',
  execute: async (args, { err, settings, storage }) => {
    if ((await storage.contacts.list()).length >= settings.maxContacts) {
      err.invalidArguments('contact limit reached; delete one first');
    }
    await storage.contacts.put(args.id, { email: args.email, name: args.name });
    return `contact ${args.id} saved`;
  },
  parameters: z.object({ email: z.email(), id: z.string().min(1), name: z.string().min(1) })
});
```

A tool with `approval` always stops for a human, who sees the full payload before it runs; one without never gates. The channel and the trace disclose both, line by line. `execute` returns the text the model reads, and raises the two failures a tool controls through `err`: `invalidArguments` continues the turn, `unresolved` ends it as an unconfirmed side effect.

**Testing.** `@collegium/sdk/testing` builds the context `execute` receives, over in-memory storage that validates and parses as the deployment's store does. Pass your config; settings go through your schema, so defaults apply.

```ts
import { createTestContext, PluginToolFailureError } from '@collegium/sdk/testing';

const context = createTestContext(config, { settings: { maxContacts: 1 } });
await save.execute({ email: 'ana@example.com', id: 'ana', name: 'Ana' }, context);
await expect(save.execute({ email: 'ben@example.com', id: 'ben', name: 'Ben' }, context)).rejects.toThrow(
  PluginToolFailureError
);
```

**zod is a peer dependency.** Install it beside the SDK and import it directly. A plugin may import `@collegium/sdk`, `zod`, and `node:` builtins; the compiler refuses every other bare specifier at boot.

**Your installed copies are for development.** The deployment compiles a mounted plugin against the SDK and zod its image carries, not the copies in your `node_modules` — those serve your editor, `tsc`, and your tests. Exactly one zod runs in the process.

**Versioning.** The SDK is released with Collegium itself and carries the same version, so the range you declare names the deployment you are writing for. Boot refuses a plugin whose declared ranges the deployment's versions do not satisfy. Before v1 any release may break a plugin, so declare the versions you tested against and re-declare them when you update.

Full guide: [collegium.sh/docs/guides/write-a-plugin](https://collegium.sh/docs/guides/write-a-plugin)
