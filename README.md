<div align="center">
  <a href="https://github.com/joshunrau/collegium">
    <img src=".github/assets/logo.png" alt="Logo" width="100" >
  </a>
  <h3 align="center">Collegium</h3>
  <p align="center">
    The agent framework for the work you can't git revert
    <br />
    <a href="https://collegium.sh">
      <strong>Learn More »
      </strong>
    </a>
    <br />
  </p>
</div>

<hr />

> [!WARNING]
> Collegium is currently in a very early beta stage. While some functionality is already available, the project is still undergoing rapid iteration and development. Future releases will change the configuration schema, plugin architecture, or other core behavior without notice or backward-compatibility guarantees. We do not recommend using Collegium in production environments
> at this time.

Collegium runs LLM agents as members of your team's chat (Mattermost), each with its own name, tools, and memory. They handle the work that isn't writing software: email, research, and follow-through. Most agent frameworks hand a model a shell and let it iterate unattended until the task looks done; that shape was built for code, where a failed attempt costs nothing and every change is reviewable as a diff before it ships. Business work is neither: actions are visible to clients and colleagues the moment they happen, and many cannot be taken back. Collegium is the structural response: agents work in the open, and anything consequential stops and waits for a person.

## Design Principles

- **Everything happens in your chat.** The work, the tool calls, the questions, and the results all land in the conversation; if work is happening, there is a post you can scroll to.
- **Consequential actions wait for you.** The exact email before it is sent, the exact file before it is written: you see the full payload, then approve it, deny it, or deny it with a reason the agent can act on.
- **Capabilities are granted, never ambient.** An agent holds exactly the tools its role requires and nothing more; even shell access is a grant, not the default way work gets done.
- **Deterministic starts, clean stops.** Agents act when a person addresses them or when code you configured announces work, never on their own initiative, and when anything goes wrong they stop and say so.
- **Business logic is code, not prompts.** A procedure that matters is a plugin: deterministic TypeScript you write once, review once, and grant to the agents that need it.
