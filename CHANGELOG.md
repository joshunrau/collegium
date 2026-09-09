## [0.0.1-beta.11](https://github.com/joshunrau/collegium/compare/v0.0.1-beta.10...v0.0.1-beta.11) (2026-09-09)

### Features

- hold `/collegium` in a Mattermost plugin and declare its subcommands at boot
- accept a post permalink in `/collegium.forget` and `/collegium.trace`
- add the framework preamble and the `builtins::now` core tool
- read mentions with Mattermost's grammar, replay reasoning within a turn, and reject transcribed tool calls

### Bug Fixes

- give the image the root certificates Go reads

### Refactoring

- derive the command surface from one wire type and read server settings once
- render the preamble from a template constant
