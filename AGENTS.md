# AGENTS.md

Multi-agent orchestration framework: one Node/TypeScript process runs multiple
LLM-backed agents that talk to humans and to each other over Mattermost, and
execute tools only under an approval-gated policy. A detailed description of the
framework is outlined in `SPEC.md`.

## Commands

Package manager is pnpm (>=11). Node version: see `.nvmrc`. The repository is a pnpm workspace —
`@collegium/app` (the framework, in `app/`), `@collegium/core` (shared primitives, in
`packages/core/`), `@collegium/config` (the deployment's declared inputs, in `packages/config/` —
schemas the app parses at boot and the docs site generates its reference from),
`@collegium/sdk` (the sole import surface for plugins, published to npm so one can be written
outside this repository, in `packages/sdk/`), and the example plugin under `plugins/*`. Dependencies
point one way: plugins → sdk → core ← config ← app. The app depends on the SDK without importing it —
the edge is what carries it through `turbo prune` into the image, where the plugin compiler resolves
it by specifier — and never imports a plugin at all. The root scripts below run
across the workspace via turbo, so everything runs from the repo root. Instance files (`.env`,
`config.json`, `docker-compose.yaml`) live at the workspace root, beside the packages rather than
in them.

```sh
pnpm dev                    # start the server in watch mode
pnpm lint                   # run tsc and eslint --fix (mutates files)
pnpm format                 # run prettier
pnpm test                   # run vitest
pnpm test <path>            # run a single test file
```

## Hard Rules

- Ask before writing code if the task is ambiguous or its stated scope cannot accomplish the goal.
- No new dependencies without asking in-conversation.
- Whenever making any code changes, run `pnpm lint` and `pnpm test` from the repo root and fix failures before declaring the task done.
- Validate all data crossing into the process (network, LLM output, disk, env) with a Zod schema at the perimeter. Trust the interior; do not re-validate downstream. The only exception to this is in end-to-end tests, where the test serves as validation.
- Default to no comments. Assume the reader is fluent in the language, has read the file, and wrote the adjacent code. Write one only if you can state the specific wrong action a competent engineer would take without it, and types and tests wouldn't catch that action — if you can't write that sentence, delete the comment.

## What Good Code Looks Like Here

Each principle applies where its problem exists; machinery without its justifying problem is ceremony, and ceremony is worse than plain code.

- Boundaries are the design. Where the modules are, what each owns, and how narrow their surfaces are matters more than any local cleverness. Get the boundaries right and the code inside them stays simple.
- Correctness is structural, not vigilant. A correct system is one where the invalid state cannot be written, not one where a careful person catches it. Anything a human must remember, the compiler should remember instead.
- One source of truth; everything derived. A contract exists once; types, variants, and fixtures flow from it. Two artifacts that must agree is a bug waiting for its trigger.
- Strict data validation at the boundary, trusting inside. Data is distrusted exactly once — at the perimeter — then the interior runs clean, with no defensive re-checking cluttering the logic.
- Complexity concentrated, periphery boring. Sophistication lives in a small framework core so that ordinary code stays trivial, short, and fully inferred. Clever call sites mean the cleverness is in the wrong place.
- Shape is never repeated. Shared structure gets abstracted — with types before runtime indirection — so change propagates instead of being replicated.
- The file tree tells the story. Narrow modules, one reason to change, split before the pain.
- Names and types carry all meaning. Guards first, success path flat, reading top to bottom.
- Fail loudly on an undeclared policy.

## Architecture

**A module is a boundary, not a folder.** It owns its data, its rules, and its invariants; the rest of the system interacts with it only through its exported surface. No reaching into another module's internals, no importing from another module's subdirectories — if something is needed across the boundary, it is exported deliberately or it is not available. When a rule lives in a module, callers ask the module (an intent-revealing predicate); they never read its state and reach their own conclusion.

**The entry layer holds no logic.** A request handler, command, or message consumer declares its policy, binds and coerces its inputs, and delegates in a single expression. Every decision of consequence lives one layer in, so the entry layer reads as a table of contents for the application's surface.

**Vendors sit behind a seam.** Domain code never touches a third-party API directly. Each vendor is wrapped in an app-owned adapter, injected as a dependency, shaped by what this application needs — a few named operations, not a mirror of the vendor's surface. The test: replacing a vendor rewrites only its adapter.

**Dependencies point one way.** Domain code depends on abstractions the app owns; adapters depend on vendors; nothing in the domain knows which vendor is behind a seam. A dependency cycle between modules means the boundary is drawn wrong — redraw it, don't work around it. One exception, deliberate: a module may import a _type_ from another module's leaf type file (one holding only type declarations and importing nothing itself). Such an import erases at compile time and cannot loop at runtime.

**Do not couple generic utility functions with classes.** Do not add standalone functions to files exporting a single class. These should be in ``<name>.utils.ts`.

### Module map

```
app/src/
  activation/     decides WHEN a turn starts: addressing, debounce, lock acquisition, drain, trigger flush
  agents/         identity and policy — a passive profile registry holding grants and effective tool settings, no execution
  approvals/      approval lifecycle, pending-decision registry, prompt rendering
  channels/       triggering mode, the channel lock, the peer roster cache, the multi-mention policy
  chat/           the Mattermost seam
  commands/       the slash-command entry layer and its handlers
  config/         the ConfigService and EnvService: config.json and process.env read and parsed against @collegium/config
  conversations/  the post store, the channel window, episodes, forget, backfill
  core/           shared schema/type primitives
  credentials/    the Mattermost tokens provisioning minted, read by the app and written by nothing else
  formatting/     display formatting: the shared date formatter (fixed locale, operator timezone)
  halt/           the §7.4 circuit breaker: hourly turn ceiling and the global halt
  health/         liveness
  inference/      model providers, tool calling, transport retry
  logging/        logging
  mail/           the mail seam: Exchange and IMAP providers, inbound polling and thread rendering, outbound send, outage notices (§3.13)
  memory/         the memories table and per-agent lock, and the memory toolset
  notifications/  system-bot output — every string deterministic (§3.2)
  plugins/        boot-time plugin loading: locating a mounted plugin, compiling it behind the bundler seam, the toolset perimeter, the contributions registry (§3.14)
  prisma/         the typed store client
  provisioning/   the admin seam: reconciles Mattermost onto what config.json declares, before the app boots
  queue/          the per (agent, channel) pending pointer
  runtime/        boot orchestration, shutdown, crash handling
  shell/          the §A2 confinement seam: per-agent OS user derivation, sudo-scoped execution, boot probe
  skills/         the skill library and manifest, and the one place a skill document is read off disk
  testing/        test-only factories and mocks, excluded from the build
  tools/          the machinery alone: registry, executor, settings resolution, toolset storage — toolsets live in their owning modules
  triggers/       the trigger table, webhook intake, idle-gated posting
  turns/          the engine: context assembly, model loop, budget, status post, failure taxonomy, turn control, fragment folding
  utils/
  web/            the browser: turn-scoped Camoufox sessions, ref-stamped snapshots, page-to-markdown; and the plain HTTP fetch beside it
  workspace/      the workspace directory and its confinement check, and the workspace::write toolset
```

## Conventions

Define Zod schemas for data validation; derive types via `z.infer`. Convention: `$`-prefixed schema, same-named inferred type, type declared first:

```ts
export type $Entity = z.infer<typeof $Entity>;
export const $Entity = z.object({ ... });
```

Generic schema combinators take `$$`:

```ts
export const $$Wrapper = <TSchema extends z.ZodType>(schema: TSchema) => { ... };
```

Variants by composition from a base shape, never from scratch. Schemas only
for data actually parsed at a perimeter; everything else is a plain type.

The perimeters in this system are: the Mattermost websocket, the Mattermost REST API, HTTP request
bodies, LLM output, `config.json`, skill files on disk, `process.env`, and plugin packages (their
`package.json`, the bare specifiers they import, their entry module's default export, and each
granted toolset's merged settings against the schema it declares). **SQLite is not a perimeter** — it is our own store, written only through a strictly
typed client, so a read from it is interior data and is trusted. Plugin storage reads are the one
qualified case: parsed against the declaring plugin's collection schema, because rows may outlive
the schema that wrote them.

Failure handling: the project's own `Result<TValue, TError>` from `@collegium/core/utils` at
seams where failure is an expected outcome the caller must branch on — inference, tool execution,
approval resolution, post delivery. `throw` is for programmer error and boot misconfiguration.

Persisted enum-like values are **Prisma enums**; the schema is the single source of truth and the
generated union is what the rest of the codebase imports. The column is `TEXT` with no `CHECK`
constraint, so the guarantee is the client's — enough, because nothing writes to this database except
through that client.

## Types

Strict mode; no casting at call sites. No loose records where a closed key set is known. If only a subset of keys is known, type those keys and add an index signature. Type safety takes precedence over convenience.

Advanced type-level constructs (e.g., conditional types, template literal types, inference extraction, mapped types) are a routine tool.

## Naming and File Organization

Names are the architecture made legible: module names say what is owned, file names say what kind of thing lives there, method names state the full contract — including side effects — without requiring the reader to inspect the body. Descriptive over terse; no vague abbreviations. This holds at every level, including generic parameters and private helpers.

Filenames are NestJS-style `<name>.<kind>.ts`.

Only files named for the module itself sit at the module root — strict, not a default. Everything else goes in a subdirectory named for a cohesive concern, created on demand. A file keeps its honest name and moves; never bend a name to justify its location.

Split a module as soon as it has more than one reason to change, rather than after the pain. The threshold for splitting is low.

## Tests

Keep test bodies short; each verifies one behavior. Test descriptions are concise and grammatical. Do not write too many test cases. We are moving fast. Test the core functionality and scaffold the structure.

When testing NestJS providers, tests should use `Test.createTestingModule`, following conventions, unless there is a compelling reason to do otherwise.

## Process

Work incrementally so the system is understood as it is built.

Treat comments or questions as discussion openers, not instructions. Respond agree/disagree/clarify with reasons, implement only the agreed set, and disagree genuinely when warranted — a well-defended position is accepted.

## Communication style

Write to me as a busy professional. I am an experienced software engineer and can follow detail when needed, but I am not steeped in this project's internals. Unless there are outstanding questions, report conclusions, not your reasoning process.

- Lead with the bottom line in 1–2 sentences.
- Put every action item in ONE list at the bottom. Never scatter them through the body.
- Body = skimmable context supporting those actions, same order. Default to short; offer to expand rather than dumping.
- If my intent is unclear or a decision is mine, stop and ask a specific question instead of guessing.
- Ask questions one at a time, waiting for my answer before the next. Multiple questions at once is bewildering.
- Direct and precise: no praise, filler, or hedging. State bad news plainly.
