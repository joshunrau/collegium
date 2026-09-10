## [0.0.1-beta.12](https://github.com/joshunrau/collegium/compare/v0.0.1-beta.11...v0.0.1-beta.12) (2026-09-10)

### Features

- **agents:** add a shared behavioral baseline ([647551f](https://github.com/joshunrau/collegium/commit/647551f88d729aba2e9a0d2aaff91705106cb08b))
- **agents:** add selectable personalities injected into the system prompt ([e3e24fe](https://github.com/joshunrau/collegium/commit/e3e24fe2e6a708f5fdc1ce86bdc2e145f7dc1032))
- **commands:** replace prompt with inspect ([04624c4](https://github.com/joshunrau/collegium/commit/04624c40ed22974b08fd35bd086bb40794c8a7a7))
- **commands:** show a memory body from the channel ([c505718](https://github.com/joshunrau/collegium/commit/c505718272a837a4cdd4a00db09f6931992bd66e))
- **config:** raise default action budget to 25 and hourly ceiling to 500 ([49cdf31](https://github.com/joshunrau/collegium/commit/49cdf319b56820670959998b22a3db1d1d5bc8d5))
- **memory:** let an agent forget one of its memories ([c122325](https://github.com/joshunrau/collegium/commit/c122325070bba9f72661918ff3e5335450a6fbab))
- **turns:** persist reasoning and replay history in native form ([dc2207d](https://github.com/joshunrau/collegium/commit/dc2207d4b5c2bbd8754995d2827c071cb3fcb76c))
- **turns:** replay a tool result by the text the tool names for history ([e422151](https://github.com/joshunrau/collegium/commit/e422151801ed6ddcbc559e6603b2298fbecf1ab5))
- **turns:** state the context limit, resumption, and skill loading in the preamble ([ff05414](https://github.com/joshunrau/collegium/commit/ff05414ad160d438d13b24631cd0f01bd801d65b))
- **web:** add hover and mark the refs CSS hides ([7063d65](https://github.com/joshunrau/collegium/commit/7063d65b4a97c4184db5eee4fc76b9effa5a9ee7))
- **web:** follow a tab the page opens into the session ([565fa7e](https://github.com/joshunrau/collegium/commit/565fa7e8fe87846944c219bdf2f01ffde71aa7ae))
- **web:** report a tab the page opens instead of following it ([6a26165](https://github.com/joshunrau/collegium/commit/6a2616560fcd9aaddff9d51d954e3200a695b854))
- **web:** resolve link and image addresses against the page ([f7a584d](https://github.com/joshunrau/collegium/commit/f7a584da58ea65bc2c8ebcaf7894a2f0624b55a7))

### Bug Fixes

- **activation:** leave the queue standing after a failed exit ([68f49f0](https://github.com/joshunrau/collegium/commit/68f49f041d34f48343b0b51f6c8aeaab78c31893))
- **commands:** import the modules the inspect handler depends on ([b54076f](https://github.com/joshunrau/collegium/commit/b54076f62e4712148d5a87cbb8bed927de623b98))
- **turns:** describe the budget extension flow as the runner performs it ([d92d386](https://github.com/joshunrau/collegium/commit/d92d3864bd9b5ce4896322842de7803d28b6ef6f))

### Refactoring

- **memory:** name the delete tool's vocabulary after delete rather than forget ([973ad5c](https://github.com/joshunrau/collegium/commit/973ad5cea45866fa3cde376d15e813b47a987f9e))
- move system prompt into context.constants.ts ([b15dceb](https://github.com/joshunrau/collegium/commit/b15dceb4c5c117d76db2fc9568938f8b8ddab014))
- **turns:** render the system prompt through a class backed by a text formatter ([0dbba91](https://github.com/joshunrau/collegium/commit/0dbba91b7300324422b5ea951d6da5c4e176e660))

## [0.0.1-beta.11](https://github.com/joshunrau/collegium/compare/v0.0.1-beta.10...v0.0.1-beta.11) (2026-09-09)

### Features

- hold `/collegium` in a Mattermost plugin and declare its subcommands at boot
- accept a post permalink in `/collegium forget` and `/collegium trace`
- add the framework preamble and the `builtins::now` core tool
- read mentions with Mattermost's grammar, replay reasoning within a turn, and reject transcribed tool calls

### Bug Fixes

- give the image the root certificates Go reads

### Refactoring

- derive the command surface from one wire type and read server settings once
- render the preamble from a template constant
