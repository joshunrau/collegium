# Security Policy

Collegium gates every consequential action behind a human approval (SPEC.md A5) and confines
shell access to a dedicated OS user per agent (A2). If you find a way around either, we want
to hear about it.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting for this repository (Security tab → Report a
vulnerability). Include:

- a description of the issue and its impact,
- reproduction steps or a proof of concept,
- the version or commit you tested.

We will acknowledge your report within 3 business days, keep you updated as we work on it, and
credit you in the release notes when the fix ships, unless you prefer otherwise. Please give us
a reasonable window to fix before public disclosure.

## Scope

In scope, treated as high severity:

- Bypasses of the approval gate (SPEC.md A5, §3.7, §6.2) by any means, including prompt
  injection steering a tool call toward an action it should have blocked on, or a plugin
  acting outside its declared toolset (§3.14).
- Escapes from shell confinement (A2, §6.1): an agent's dedicated OS user reading another
  agent's home directory, the framework's own tree, or gaining access beyond the user it was
  confined to.
- Escapes from workspace confinement (the `workspace` toolset, §3.4).
- Bypasses of the halt (§7.4): an agent continuing to run turns past the hourly ceiling, or
  resuming without an explicit `/collegium resume`.
- Unauthorized use of the callback endpoints (`POST /decisions`, `POST /commands`,
  `POST /triggers`, §6.4) from outside the network boundary those endpoints rely on.
- Leakage of credentials held by the `credentials/` module.

Out of scope:

- Vulnerabilities in Mattermost itself, or in a third-party model provider.
- Issues that require an operator having already granted an agent a capability it should not
  have been granted (for example, shell access to an agent that should not hold it): that is a
  deployment configuration choice, not a framework vulnerability.
- Issues that require an already-compromised host.

## Supported versions

The latest published image only (`ghcr.io/joshunrau/collegium`). Collegium has no auto-update
mechanism; operators are expected to track the newest published tag.

There is no bug bounty program at this time.
