# **Multi-Agent Orchestration Framework**

## **1. What This Is**

A single Node/TypeScript process running several LLM-backed agents. Each agent is a distinct identity that appears in our Mattermost workspace as a bot user, holds conversations with staff, and executes a fixed set of hand-written tools — subject to human approval on every consequential action.

The agents perform non-engineering business work: monitoring inboxes, drafting replies, researching on the open web including JavaScript-rendered pages. Each has its own system prompt, model, tool set, skill set, and private memory.

### **1.1 The Problem This Solves**

We previously ran a third-party agent framework (Hermes). It failed in the following ways, and this design is largely a response to them.

- **Arbitrary destructive commands against SQLite databases** Unrestricted filesystem access; difficulty inspecting entire chained commands; reliance on shell as the primary work tool; agent not respecting the system prompt.
- **Scattered files across the server** Unrestricted filesystem access.
- **Overwrote documentation with incorrect content** Unsupervised writes; difficult to inspect, and rapid iteration meant nobody read the payload.
- **Spawned sub-agents whose work was uninspectable** Runtime agent creation; no durable identity per worker.
- **Ignored system prompts, pursuing solutions at any cost** Instructions were advisory; no hard constraints.
- **Applied one-off patches to its own codebase** Buggy, vibe-coded software with no boundary between the agent and the framework running it.
- **Multi-agent gateway broken** Third-party coordination layer we did not control.
- **Mattermost integration missing critical features** No approval mechanism existed at all.

These group into four classes, each with a structural response:

- **Capability** — reached things it should not have. Response: OS-level confinement and hand-written tools (A2, §6).
- **Supervision** — the action looked fine, the content was wrong. Response: approval gate with full payload disclosure (§6.3).
- **Constraint** — instructions were suggestions. Response: framework-enforced limits, never prompt-enforced (§5, §7.4).
- **Substrate** — the coordination layer was someone else's. Response: Mattermost as the only substrate (A1).

### **1.2 What It Is Not**

Not an autonomous agent platform. Agents do not run continuously, do not decide when to act, do not write their own instructions, and do not create other agents. Every consequential action stops and waits for a human.

The design trades throughput and autonomy for supervisability and predictable failure. That trade is deliberate.

## **2. Design Axioms**

Most of this specification is a consequence of these five constraints rather than an independent choice.

### **A1 — Mattermost Is The Substrate**

**Mattermost is the only substrate for identity, addressing, and work delivery.** There is no internal message bus and no scheduler-to-agent RPC path.

Triggers may originate anywhere — cron, HTTP, a mailbox poll — but **an agent is only ever activated by a Mattermost post.** SQLite holds a control state that points _at_ posts; it never holds work that exists nowhere else. Every pending item in the system corresponds to a post you can scroll to.

_Why:_ the alternative is a coordination layer living only in process memory — invisible in the client, lost on restart, and in the Hermes case owned by someone else. Under this rule, if work is happening there is a post you can point at. Debugging is scrollback.

### **A2 — No Ambient Code Execution**

Every capability is a hand-written TypeScript function with a schema, reviewed and immutable at runtime. No dynamic tool creation, no runtime agent spawning.

**Shell access is a capability that may be explicitly granted to an individual agent.** It is not the default and not the normal way work gets done. Where granted:

- Every command requires approval.
- The agent runs as its own dedicated OS user, one per shell-holding agent.
- That user owns its home directory and nothing else, mode `700`.
- The framework's own tree is unreadable by agent users.
- Agent home directories are unreadable by other agent users.

The capability surface of an agent is therefore fully enumerable by reading config.

### **A3 — Deterministic Activation**

Non-LLM code decides **when** an agent acts. The agent decides **what** to do once activated. An agent can never schedule itself, wake itself, or extend its own operating window.

_Why:_ an agent with autonomous initiative and idle cycles will find work nobody asked for.

### **A4 — Clean Stop Over Graceful Degradation**

When anything goes wrong — denial, malformed output, budget exhaustion, restart, rate ceiling — the agent stops and says so. It does not retry, route around, or degrade quietly.

_Why:_ a system that degrades gracefully hides its failures. We would rather absorb interruptions than debug an agent that has been quietly wrong for six hours.

### **A5 — Visibility Is Not Consent**

Every action an agent takes is recorded and surfaced. **Blocking approval is reserved for actions with consequences**, because approval frequency is inversely related to approval quality: a gate that fires constantly is answered reflexively and stops being a control.

**Ungated does not mean unsupervised.** This is why reads are ungated, why the status post exists, and why the full trace is retrievable on demand rather than streamed into the channel.

## **3. Concepts**

### **3.1 Agent**

A persistent identity with a name, persona, system prompt, assigned model, assigned tool set, assigned skill set, and private memory.

Each agent is a **Mattermost bot account** with its own access token, addressable as `@{username}`, shown with a `BOT` tag in the member list.

Agents are persistent colleagues, not task-scoped job runners. There is one instance of each agent, continuously; conversations are episodes in an ongoing relationship rather than independent invocations.

Provisioning is a deployment act, not a runtime one: before the app starts, a separate process reconciles Mattermost against the configuration — creating the team, the channels, one bot account per declared agent, and the access token each is addressed with. It converges; boot only refuses. Channel membership is what it does not converge: every bot joins the main channel, an agent joins the channel its mail arrivals are announced to, and the system bot joins every channel the configuration names, so that its notices (§3.2) have a place to land in each of them — nothing else. Who else belongs in a channel is set in Mattermost by the people who run it, and §3.10 is checked against that membership rather than against a second declaration that would have to agree with it. Its first act against a Mattermost it did not start is a refusal of its own: the server's settings must permit bot accounts, permit personal access tokens, and allow the callback address the app is reached on, and provisioning names each one it finds missing before creating anything — the last of the three otherwise fails nothing until the first approval button is clicked. The administrator it acts as is named by a personal access token where the server already exists, and by a password only where a fresh install has no account to sign in as. Nothing the running framework does creates an account or a channel, and **there is no runtime agent spawning**: every worker has a durable identity and its output is in a channel.

### **3.2 System Bot**

A separate Mattermost bot account used for all _mechanical_ output: triggers, boot announcements, interruption notices, and refusals.

**Invariant: a post from the system bot is never an agent thinking.** All of its output is fixed strings or templated facts, never LLM-generated. The same rule applies when the framework posts _under an agent's account_ — budget notices and stop notices are deterministic code speaking as the agent, not the agent speaking.

**Nothing the system bot posts enters an agent's queue** (§5.2). Trigger delivery is governed by §4.2 instead.

### **3.3 Turn**

**The unit of execution.** One activation of one agent in one channel: assemble context, call the model, execute tools, produce output, terminate.

A turn is created by exactly one of:

- a human posting in a DM with the agent
- a human posting in a respond-to-all channel
- a human mentioning the agent in a channel
- another agent mentioning the agent
- the system bot posting a trigger that mentions the agent

**Posting is performed by the framework, not by a tool.** Text emitted alongside a tool call updates the status post and is transient. Text emitted with no tool call is the turn's final output and terminates the turn. Posting does not consume the action budget.

### **3.4 Tool**

A hand-written TypeScript function exposed to the model with a schema. **One tool per action** — there are no tools whose behaviour branches on an `action` argument; a tool that would is two tools.

**A tool's identity is two segments, `[namespace, tool]`,** held structurally everywhere and rendered per audience: operators, approvers, config, traces, and errors see `mail::send`; the model sees `mail__send`. Each segment is lowercase snake_case with single underscores, which is what makes `__` an unambiguous join; the wire form is produced at request assembly — applied to the tool schemas and the replayed call history together, so the model never sees two spellings of one tool — and retained nowhere downstream of the provider response. Segments are rendered, never parsed, except at the config perimeter.

**A toolset is a namespace and everything that belongs to it**: its tools, the services they may reach, the settings they are configured by, the storage collections they own, the skills they ship. A toolset lives in the module that owns the capability — `mail/`, `memory/`, `web/`, `workspace/` — never in a central tool directory, and a framework toolset's namespace equals its module directory name. Toolset declarations are inert data: a tool body names services by injection token and imports only their types, so the config perimeter derives the grant grammar from the declarations themselves and names survive into the type as a literal union (`'mail::send' | 'memory::read' | …`).

Each tool declares, alongside its description and parameters:

- **`approval`** — present means the tool **always** gates (§3.7): the function renders the payload the approver reads and cannot decline. Whether a granted tool can act without a human is therefore answerable from config alone; a tool whose gate would depend on its arguments splits into two tools.
- **`retryable`** — whether a timed-out call may be reported to the model as a plain failure (§7.2); false, the default, ends the turn as an unconfirmable side effect.
- **`budgetExempt`** — never billed against the action budget (§5.3). Framework toolsets only; the plugin perimeter rejects it.

Execution receives exactly the context its toolset declared: each declared service under its own name, `settings` (per turn, from the acting agent, §8-style resolution below), `storage` collections, and always `turn` — four facts: the acting agent, the channel, the triggering post (honestly nullable), and the turn id. Reaching anything undeclared is a compile error. A tool that creates a durable record returns its disclosure — body, description, reference, anything superseded — and the turn writes the event and the trace lines (§3.6).

Reads are generally ungated: search, fetch, read mail. Writes, shell commands, and anything externally visible carry `approval`.

**Authority parameters are never model-supplied.** Any argument determining _whose authority an action carries_ is fixed in tool settings — the `from` address on outbound mail, credentials for external services. The model may request that mail be sent; it cannot choose who it appears to be from — the mailbox and its credentials are fixed in the agent's mail settings and boot refuses a mail-granted agent without them (§3.13).

**Filesystem scope.** `workspace::write` and `shell::run` are confined to the agent's own directories — the former by the workspace module's path confinement, the latter by OS permissions (§A2). Purpose-built tools may write to real systems (e.g., the application database) by their own internal logic; those are individually reviewed and their write targets are fixed in code, never chosen by the model.

**Browsing.** The `web` toolset drives a real rendered browser (Camoufox) in a turn-scoped session: `web::navigate`, `web::click`, and `web::fill` act against element refs from the latest snapshot, each action returning the page as markdown. **It may submit forms and sign in where the task calls for it** — a great deal of the open web is unreachable otherwise, and a tool that could not search or authenticate would be a tool for reading front pages.

It is ungated all the same. The per-agent grant decides who may browse at all, the status post traces every action live, and a per-action or per-session approval would stall autonomous turns while approving only an entry URL — never the later actions that could transmit. This is the widest ungated surface in the system and is named as such rather than hidden: an agent that browses can transmit on its own authority.

Two compensating controls follow from that. **Credentials are never disclosed**: fill text is masked in the status post and in the trace, and a snapshot reports whether an input holds text but never which text, so a password the model types is neither broadcast to the channel nor read back into its own context. **Scope is enforced, not requested**: only `http(s)` URLs are opened, and only on the public internet — a `file://` URL, or a host naming this machine or its own network, is a typed refusal, because the browser runs as the orchestrator's OS user rather than inside the §A2 confinement that governs `shell::run`.

Sessions are fresh anonymous contexts disposed at turn end — no cookies persist and no login outlives the turn that made it. robots.txt is not consulted: these are agent-driven reads at human pace, not crawling. Non-HTML resources (PDFs) are a typed refusal.

**Grants and settings are one config mechanism.** `agents.<username>.tools` lists namespaces or single `ns::tool` refs; a namespace grant covers tools added to that namespace later, so a plugin update can widen an existing grant with no config change — accepted deliberately, since installing a plugin is already a trust decision. Effective settings per toolset are `agentDefaults.toolSettings[ns]` merged shallowly with `agents.<username>.toolSettings[ns]`, then parsed against that toolset's own schema. Two generic rules replace every toolset-specific config refinement: settings for an ungranted toolset is an error, and a granted toolset whose merged settings fail its schema is an error — "mail requires a mailbox" is what the mail settings schema says, not a rule anyone maintains, and no toolset is named anywhere in the config module.

**Core tools are framework machinery, not grantable capability.** `skills::load` and `triggers::resolve` are in every agent's tool set — loading a skill the agent was already assigned, clearing a trigger the framework itself raised — and naming one in config is an error; their namespaces never appear in config at all. A plugin cannot contribute one.

### **3.5 Skill**

A procedure document stored in the repository: Markdown in `app/src/skills/library/`, one per name in `SKILL_NAMES`, with `description`/`title` frontmatter. A disk perimeter — parsed and Zod-validated at boot.

Each agent's system prompt carries a **skill manifest**: the names of its assigned skills plus one line of description each. The full body is pulled into context on demand via `skills::load`.

**A skill shipped by a toolset is namespaced like a tool** — `bookmark::saving-bookmarks` — and granted the same way; any toolset may ship skills, framework or plugin. Skill names keep the dashed convention of skill files, since a skill never reaches a provider as a tool name. Framework skills belonging to no capability keep bare names — `handing-work-to-a-peer` — which cannot collide, because every other skill carries a namespace. Granting a namespace's tools does not grant its skills, or the reverse. Core skills — `handing-work-to-a-peer` — are in every agent's manifest, are not grantable, and naming one in config is an error.

**Agents cannot write skills.** Skill authorship is an administrative act. The manifest is what makes on-demand loading safe: an agent may fail to judge _when_ a procedure applies (an ordinary error) but can never be unaware that it _exists_ (a structural blind spot).

Where step ordering is load-bearing — check the database _before_ drafting, log _after_ sending — encode the procedure as a single hand-written tool rather than describing it in a skill. A procedure in a prompt is a suggestion; the model will eventually skip the step that mattered.

### **3.6 Memory**

A `memories` table in SQLite, accessible to agents only through a tool, never through raw SQL. Each entry has a **description** (the trigger) and a **body** (the content).

- **Descriptions are loaded into the system prompt on every turn.** Bodies are loaded on demand.
- **Writes are ungated** — the single exception to A5.
- Entry count, description size, and body size are all capped, by the memory toolset's settings (§3.4). An over-length description or body is refused, never truncated; a write at the entry cap evicts the oldest entry.
- Every entry carries provenance: written-at timestamp and originating post ID. Entries are shown to the agent, in the trace, and to `/collegium.memory` by a **reference** — the first eight characters of the id — which the store resolves back, refusing rather than guessing if it ever matched two.
- Memory is per-agent and never shared between agents.

_Why ungated:_ gating a memory write would block an entire turn on a triviality — an agent stalling for hours because it wanted to record a phone preference. Memory formation cannot sit behind human latency or it will not happen.

_Compensating control:_ the write tool returns a disclosure — description, body, the record's reference, anything superseded — and the turn writes it into the trace and a status-post line. This is **detection, not prevention** — the write has already happened.

Because turns are per-channel (§5.1), an agent may have concurrent turns writing memory. Memory writes therefore take a **per-agent lock**, since the entry cap is a read-modify-write.

Memory is also the one path by which information crosses channels: something learned in channel A appears in the system prompt for channel B. This is intentional but worth knowing, since context is otherwise strictly channel-scoped.

### **3.7 Approval**

A blocking request for human consent, rendered as a post **under the agent's own account** with interactive buttons — the payload is model-proposed content, which §3.2 forbids the system bot to carry.

- **Approve** — the tool executes; the turn continues.
- **Deny** — the turn terminates; the agent posts asking how to proceed.
- **Deny with reason** — opens a dialog; the reason is fed back as the tool result and the turn continues under the same budget.

The prompt must show the full payload, not just the intent. Where a payload exceeds what a single post can carry, the prompt shows a bounded prefix inline and the complete payload as an attachment (§6.2). Once resolved, the prompt post is rewritten into a terminal state and its buttons removed.

**There is no timeout.** The agent waits, for days if necessary, until a human answers. Work queued behind it accumulates without bound (§5.2).

**Who may approve: any human present in the channel.** There is no separate approver list, because a config-based roster would be a second access-control system that silently drifts from channel membership. Under presence-confers-authority there is exactly one such mechanism and it is managed by the client. The decision endpoint verifies the approver against channel membership; a decision from outside the channel is refused.

### **3.8 Context Window**

Each turn assembles context fresh from SQLite:

1. System prompt
2. Skill manifest (§3.5)
3. Memory descriptions (§3.6)
4. Peer roster (§3.11)
5. Tool definitions
6. **Channel window** — recent posts from the current channel, interleaved with the trace of this agent's own turns there (§8.2), walked backwards until a token budget is exhausted. The trace is never a peer's: an agent reads its colleagues through their posts alone.

The token budget is a character-ratio estimate (~4 characters per token) behind a named seam. There is no tokenizer dependency.

There is no threading. All posts are channel-level, so **context is pure recency**: no structural marker indicates where one piece of work ended and the next began. `/collegium.reset {agent}` provides a manual episode boundary; context never reaches back past the most recent one.

DM context follows the same mechanism as any other channel.

### **3.9 Work Channel**

Each agent generally has a dedicated Mattermost channel containing that agent and its authorized humans.

**All channel configuration is declared in configuration. Agents have no input into topology.** Membership is not part of that declaration: it is held in Mattermost and set by the people who run it (§3.1), so what configuration states is which channels exist and how each one triggers.

### **3.10 Triggering Mode**

A per-channel flag set at provisioning:

- **mention-required** (default) — the agent acts only when explicitly `@`\-mentioned
- **respond-to-all** (opt-in) — every human post in the channel starts a turn
- DMs are respond-to-all inherently, as a property of the channel type

In respond-to-all channels, agent-authored and system-bot posts must not trigger, or an agent will reply to its own output and loop immediately. The rule is: _human-authored post, or a mention from an agent or the system bot._

**A respond-to-all channel contains at most one agent.** Every human post starts a turn for every agent present, so two agents in one such channel produce two concurrent turns on the same task and two live approval prompts — precisely the harm §4.5 exists to prevent, arrived at without a mention and caught by nothing. §3.9's "generally has a dedicated channel" is guidance; this is a constraint, checked against Mattermost membership at boot and on every membership event. A violation discovered at runtime trips the global halt (§7.4).

### **3.11 Peer Roster**

**The set of other agents present in the current channel**, injected into the system prompt each turn, excluding the agent itself and the system bot. This is how an agent knows which peers it can reach.

Membership is held in an in-memory cache maintained by Mattermost websocket events — never polled — and reconciled against the API on boot, since changes during downtime are invisible to the event stream.

### **3.12 Thinking**

Private reasoning is any intermediate model computation that is not emitted as user-visible output or as a tool invocation. Such reasoning:

- is never requested as part of an agent’s response;
- is never posted to Mattermost;
- is never included in an approval prompt;
- is never stored in SQLite;
- is never returned by `/collegium.trace`;

Where a model provider reports reasoning-token usage or similar accounting metadata, the framework may store the usage count, but not the reasoning content.

### **3.13 Mail**

An agent may act as **at most one email address**, fixed in its mail settings (§3.4) and resolved from the agent's identity. Which agents can send mail is therefore answerable by reading config alone. The mailbox boundary is enforced by the provider — an Exchange app registration scoped to that one mailbox, or an IMAP account that is that one mailbox — never by the framework asking politely.

**Two provider families sit behind one seam:** Microsoft Exchange Online, and generic IMAP/SMTP with password authentication. Domain code speaks only the seam; replacing a vendor rewrites only its adapter.

**Inbound is deterministic code, not an agent noticing.** A poll reads the mailbox on a configured interval and records one trigger row per arrival (§4.2); the system bot announces it when the channel is idle. On first connection the mailbox is read to its head and nothing is announced — existing mail is not news. After that nothing is missed, across restarts and extended downtime: every arrival is recorded durably _before_ the read cursor advances, so a crash in between re-reads the same page and a stable dedupe key makes the repeat a no-op. Backlog drains at a bounded rate — one page per poll, one announcement per idle moment — rather than all at once.

**Handling an announcement marks the message read**, so the same item is not worked twice by a human and an agent. This rides the ordinary `triggers::resolve` path.

**Reading is ungated; sending is gated.** Listing, searching, and gathering a conversation return sender, subject, receipt time, and a short preview — only opening one message returns a body, and a body is never truncated. Bodies are presented as readable text whatever the sender's formatting. Attachments are described — name, type, size — and never opened; a request for their content is a typed refusal.

**Every send discloses what will leave**: the full recipient list, the subject, and the entire body, in the approval prompt (§3.7). Recipients are explicit arguments and there is no bcc field anywhere, so a recipient the approver cannot see is unrepresentable rather than merely disallowed. A reply stays in its conversation for the recipient because the provider threads it, never because the model managed it. **Drafting is not sending**: proposing wording in conversation touches no mailbox and needs no approval.

**A send is never retried.** A refusal the server answered — nothing left — is an ordinary result the agent may act on. An outcome that cannot be established is reported as unresolved and ends the turn (§7.1), because feeding "unresolved" back to a model invites exactly the duplicate the rule exists to prevent.

**Boot proves every mailbox, and distinguishes what waiting cannot fix.** An announcement channel that is a direct message or that the agent does not belong to, and credentials the provider refuses, are boot refusals naming what is wrong. A mailbox that is merely unreachable is not: the system bot says so in the announcement channel and the framework runs, polling until it recovers and saying so again when it does — the same treatment the identical outage gets a minute after boot, rather than a crash loop whose only trace is the log.

Mail is optional: a deployment with no mailbox configured runs exactly as it did before mail existed, and a partially configured one is refused before the system runs, naming what is missing.

### **3.14 Plugin**

A unit of operator-supplied capability living outside the framework: a directory of TypeScript sources mounted into the deployment beneath the plugin root, named in `config.json`, compiled and loaded once when the process boots. The framework performs orchestration and carries no business domain — a deployment's own concerns belong in plugins, so the framework upgrades without ever occupying the same files as what a deployment added, and installing one never rebuilds the image.

**A plugin is a toolset (§3.4), and its layout is the declaration.** The directory's name is the plugin's namespace, its storage scope, and its skills' qualifier: one identity, stated once and restated nowhere. `src/config.ts` default-exports the config — the settings schema agents are configured by, and the storage collections the plugin owns. Every `src/tools/<name>.ts` default-exports one tool, named by its basename; every `src/skills/<name>.md` is a skill document, granted as `<namespace>::<name>`. There is no entry module and no manifest of contributions — the framework synthesises at boot what the layout states. A plugin does not alter how the framework activates agents, orders turns, budgets actions, or resolves approvals — those remain the framework's, identically for every deployment. Contributions appear under the namespace — `bookmark::save`, `bookmark::saving-bookmarks` — and agents opt in per grant exactly as with framework capability: installing a plugin grants it to no one. Framework namespaces are reserved; `plugins[]` in config reduces to a list of names, each resolved as the directory of that name beneath the plugin root, and the plugin's settings live in the same `toolSettings` mechanism every toolset uses.

**Refused, never skipped; failures are startup failures.** A file the conventions cover either loads or stops the process from starting, naming the plugin and the file — a tool file whose basename is outside the tool-name grammar, a file under a convention directory the convention does not cover, a file missing its default export, a default export the perimeter schema refuses, a plugin that contributes neither tools nor skills, a package.json depending on anything but `@collegium/sdk` and `zod`, or failing to declare both, a declared dependency range the deployment’s own copies cannot satisfy, a directory the app cannot read, settings a granted agent supplies that the plugin's own declared schema refuses, a named skill document that does not parse, a configured grant nothing provides. Nothing about a plugin is discovered mid-turn, and nothing malformed is silently left out.

**Plugins are fully trusted; agents are not.** A plugin is operator-written code running with framework privilege — installing one is not different in kind from editing the framework, and the safety model constrains what an _agent_ may reach, not what an _operator_ may install. What a plugin decides is whether its tools gate (§3.7), by declaring `approval`; what it does not decide is whether its actions are seen — every plugin tool call is disclosed in the status post and recorded in the trace exactly as a framework tool's is (A5) — or how the framework budgets actions, which is why `budgetExempt` is absent from the plugin-facing type and rejected at the perimeter.

**The boundary is structural.** A plugin imports `@collegium/sdk`, `zod`, and `node:` builtins — nothing else; every other bare specifier is a boot refusal naming the plugin, the specifier, and the file that imported it. Both packages are rewritten at compile time to the framework's own copies, so there is exactly one zod in the process by construction — the copies an author installs serve their editor and their tests and never run in the deployment — and each package is declared and its range checked against the deployment's version at boot, save for a `workspace:`/`catalog:` protocol, which names this repository's own copy rather than a range and so has no version to disagree with. A tool body returns plain text — or text beside a disclosure — and raises the only two failures it controls through the `err` its execution context carries: `invalidArguments`, returned to the model, and `unresolved`, ending the turn as an unconfirmed side effect. The rest of the failure taxonomy is the framework's to raise, and a plain throw is a semantic failure like any other (§7.1). What the SDK does not hand over, a plugin cannot touch; the framework refactors freely behind it.

**Storage without schema ownership.** A plugin persists durable records in the framework's own store, scoped to its namespace, validated against its declared collection schemas on write and parsed on read — the one qualified read perimeter, because rows may outlive the schema that wrote them. It owns no tables, no migrations, and no database client — adding a plugin adds no migration step, and a plugin cannot reach the framework's tables (or another toolset's rows) through its handle. Beyond lookup by key, a collection answers one query grammar: an AND of conditions over the value's top-level scalar fields — equality, membership, or a case-insensitive substring on a string — with an optional limit, typed from the collection's own schema so an undeclared field is a compile error. The grammar is stated once, in core, with its in-memory evaluator; the store compiles it to SQL over the JSON payload, and a test holds the two equal. A storage write, like any durable record, can disclose itself by returning a disclosure (§3.4).

The example plugin (`plugins/bookmark`) exercises the entire contract — a gated tool, an ungated tool, settings, a collection, a skill — and is kept working by the test suite, so the contract cannot quietly rot. The SDK's `testing` entry builds the context `execute` receives over in-memory storage that validates and parses as the store does, so a plugin's tools are tested without a deployment; the example plugin's own tests use it.

## **4. Activation**

### **4.1 How Work Reaches An Agent**

All activation paths are Mattermost posts.

The alternative for scheduled work — the scheduler calling the runtime directly — is the subtle A1 violation. Everything downstream would still land in Mattermost, so it would look compliant, but the _occasion_ for the work would exist only in process memory: nothing to point at, and two ingestion paths through the runtime forever.

### **4.2 Triggers**

External events do not post directly. Deterministic code — cron, mail polling, webhook — evaluates its condition and, when it fires, writes a row to a **trigger table** in SQLite: source, target agent, target channel, a reference (sender, subject, ID, and where the source carries one, the full body), and status. Two intakes exist today: `POST /triggers` and the mail watcher (§3.13). Cron is a later adapter behind the same table.

**A reference carrying a body is disclosed in full**, inline while it fits the substrate's post limit and otherwise as an attached file the post names — the §6.2 rule, arrived at from the other side. The alternative, a preview the reader must open the source to complete, makes the channel a notification rather than a record.

**A source may own part of resolution.** Marking a trigger handled runs the source's own completion first — mail marks the message read (§3.13) — and a failure there leaves the row outstanding rather than claiming work is done. Sources register this with the trigger table; the table knows nothing about mail.

**A trigger is posted only when the target channel is idle** — no turn running, no approval pending, nothing debouncing. The system bot posts it, mentioning the agent, which starts a normal turn. If the channel is busy the row simply waits and is posted when the channel next goes idle.

One post per trigger.

**A DM is never a trigger target.** The system bot cannot be a member of a DM — Mattermost fixes DM membership at creation — so delivery has no route there. Intake refuses a DM-targeted trigger loudly rather than recording a row that can never be posted. Triggers announce unattended work, and unattended work belongs in a channel other humans can see.

**Nor is a channel the target agent is not in.** The same reasoning reaches further than the DM case: the agent's socket never receives a post in a channel it does not belong to, so the trigger would announce work that cannot be done and strand as permanently unresolvable — the outcome idle-gating exists to prevent, arrived at through the roster instead. Intake checks membership and refuses loudly.

**Nothing the system bot posts enters the queue** (§5.2). Idle-gating is what makes that safe: a trigger is never posted into a channel that cannot immediately act on it, so it can never be stranded as an unanswered post. Gating on _idle_ rather than merely on _no pending approval_ matters — an agent mid-model-call is equally unable to take the lock.

**Triggers are marked and handled by the agent**, through a tool. Without this, the outstanding list only grows and the same item is re-posted after every turn.

**Why this does not violate A1.** The table holds things to be _announced_, not work to be _executed_. Nothing runs because a row exists; something runs because the system bot posted. For most sources the table is a cache — ground truth is the mailbox — though for webhooks it is the only record, which is an honest exception rather than a hidden one.

### **4.3 What The Scheduler Decides**

Trigger predicates are deterministic code. "Nothing to report" is resolved _there_, not by the agent — there is no path where an agent wakes, thinks, and stays silent, because that would be activity outside the substrate.

### **4.4 Folding Fragments Into One Turn**

People type in fragments seconds apart. Without folding, the first fragment starts a turn and the rest are not processed. Context is assembled once, at turn start, so a fragment arriving after assembly is invisible to the turn it belongs to.

Folding happens in two places, and the second is what makes the guarantee.

**Before the turn: a short window.** A brief delay (\~750ms, resetting on each message) precedes turn start, and further messages from the same human in the same channel during it are folded into the same turn's context. This costs nothing, which is its whole justification: the common case — a mention, then the request a beat later — is absorbed before any work has been done.

**During the turn: the running turn absorbs.** A fragment from the same human arriving while that turn is still on its first model call is handed to the turn rather than queued. The turn discards the completion that only saw the first sentence, re-assembles its context, and calls again. Total coverage is therefore the window plus however long the model takes — wider than a window alone can afford to be, because waiting longer costs a human real time while absorbing costs only a discarded completion.

**Only an unaddressed post is absorbed.** A fragment rarely repeats the mention, so this is what separates a sentence being finished from a request being made. The distinction has to be drawn somewhere, and it cannot be drawn on elapsed time: the model call a turn is inside may run until the inference timeout, and over that long a human is not completing a thought. A post that names the agent again is queued and acknowledged exactly as §5.2 says, because absorbing it would silently drop work — nothing about absorption is durable.

**Absorption ends at the first action.** Once a tool has run or a post exists, discarding would throw away work that already had effects, so the turn stops absorbing and anything later takes the queue path. A **fold limit** (`activation.foldLimit`, three by default) bounds it from the other side: a human typing steadily reaches an answer instead of paying for one completion per sentence.

**Absorption is scoped to the turn's own author.** Unrelated conversation in the channel is recorded and reaches the next turn's window as it always did; it never costs a running turn its completion. Fragments arriving when no turn is absorbing — a different author, a repeated mention, a turn past its first action, an agent already busy on something else — are handled by the queue instead (§5.2), which drains them into one turn.

**Neither kind of folding is a queue.** The window occurs strictly before a turn exists, and an absorbed fragment is buffered in memory by the turn that took it. Nothing durable is created on either path, so a crash loses an absorbed fragment; the post is recorded, but nothing re-activates it. The window's **ceiling** matters for the same reason the fold limit does — without it, a human typing steadily never gets a response and the agent appears broken.

### **4.5 Multi-Agent Mentions Are Refused**

A post mentioning **two or more agents present in the channel** starts no turn and enters no queue. The system bot posts a mechanical correction: _address one agent per message._

Mentions of agents not present in the channel are inert text: an absent agent's socket never receives the post, so the harm this rule prevents — two concurrent turns on one task — cannot arise, and the post is handled as if the absent name were plain words. A DM therefore never trips this rule, since at most one agent exists there.

_Why:_ two agents working the same task produce two approval prompts for overlapping actions, and the second gets approved having half-read the first. Duplicate irreversible actions — both agents emailing the same contact — is a live risk. Picking the first-mentioned agent would be arbitrary, since mention order carries no intent and "one of you" designates nobody.

_Why, more consequentially:_ **this rule is what pins delegation width at one.** §7.4 bounds the depth of an agent-to-agent chain and says nothing about its branching factor. If a turn could address three peers, ten levels would be 3¹⁰ ≈ 59,000 turns and the hourly ceiling would be the only brake — an emergency stop, not a design. The depth limit bounds total work only because every turn can delegate to at most one colleague.

For agent-authored output the check happens at post time. The post is rejected and fed back to the model as a `user` message — _"post rejected: multiple agent mentions"_ — because the final-output branch carries no tool call for a tool result to reference. This is not a semantic failure: the model produced valid output violating a framework rule it cannot see, and one retry is cheap.

**One retry, then the turn ends** with a deterministic notice under the agent's name. A rejected post does not consume an action attempt — §5.3 counts tool invocations and a rejected post is not one — which is precisely why the rejection needs a bound of its own: without it the loop consumes no budget and is limited only by the hourly ceiling.

Agent mentions in transient status text are stripped before posting. Status text never addresses anyone.

**Detection and stripping share one grammar, and that grammar is Mattermost's.** What the framework treats as a mention is what the client highlights and notifies; anything else acts on a mention the human never saw, or ignores one they did, and A1 does not permit the framework to hold a second opinion about addressing. The two paths diverging is a defect class in its own right: a mention that activates a peer but survives stripping defeats both the width bound above and the depth limit in §7.4.

## **5. Execution Model**

### **5.1 One Turn At A Time, Per Channel**

**An agent executes strictly one turn at a time within a given channel.** While a turn is live — waiting on the model, executing a tool, or blocked on approval — that channel is closed to further turns for that agent. Other channels are unaffected.

The channel is therefore the concurrency unit. It is also the intervention unit (§7.5) and the context unit (§3.8). The two cross-channel exceptions are memory (§3.6) and the global rate ceiling (§7.4).

Acquisition of a channel lock must be a **synchronous compare-and-swap** — no `await` between checking availability and claiming it. Two debounce timers maturing microseconds apart would otherwise both observe an idle agent and both start turns.

Only one approval prompt can ever be live for a given agent in a given channel, which is what keeps approval resolution unambiguous.

### **5.2 The Queue**

A message addressed to a busy agent is **queued, not dropped**. The framework acknowledges it with a 👀 reaction on the post — not a reply, because a post per queued message would be noise in a channel where approval prompts also live.

An unaddressed fragment the running turn absorbs (§4.4) is neither queued nor acknowledged: the turn is already answering it, and the reply is the acknowledgement. The 👀 means "you are waiting", so it would be a lie there. A post that addresses the agent is always queued and acknowledged, however busy the agent is and whatever it is mid-way through.

**Drain, not pop.** When a turn ends on an exit that allows progress (§7.1) and the channel goes idle, everything queued for that channel is consumed by a single new turn. Ten fragments queued during a long turn become one turn, not ten.

**The drain is visible even when context is not.** The queue holds pointers and content arrives through the channel window, which walks back only until its token budget is exhausted. When the window cannot reach back as far as the earliest unprocessed post, the draining turn's status post says how far back context actually reached — detection, not prevention, the same posture as memory-write disclosure (§3.6).

**The queue holds pointers, not content.** Context is assembled from the channel window (§3.8), which already contains every recent post. The queue therefore stores one row per (agent, channel): that unprocessed work exists, and the earliest unprocessed post ID. Draining clears the flag; the content arrives through the normal context path. Delete the queue and it rebuilds from posts, which is why it does not violate A1.

**Nothing from the system bot is queued.** Triggers are governed by idle-gating (§4.2) instead.

**The backlog is unbounded and nothing expires.** If approvals are slow, work accumulates behind them indefinitely. This is accepted: the alternative is silently discarding work, and the failure mode of an unbounded queue is visible — a channel that has been busy for a day is obviously busy.

### **5.3 Action Budget**

**Ten action attempts per turn** (`turns.actionBudget`). An action attempt is one model-emitted tool invocation, _including invocations denied before execution._ Not counted: framework transport retries, framework posting, and the tools declared budget-exempt (§3.4) — `skills::load` and `memory::read`, the exemption being for loading context the framework already holds. A plugin cannot declare one.

On exhaustion the agent posts what it has and requests approval to extend. Approving grants a further ten attempts and preserves accumulated context. Extensions are unbounded in number, but each prompt carries the running count — _extension 4; 40 attempts so far_ — because the human in the loop is the control, and the control needs the number.

**Denying an extension ends the turn's actions, not its voice.** A bare denial terminates. A denial with reason feeds the reason back as the tool result with zero attempts remaining (§3.7), so the agent may conclude in words but not in actions — a human answering _"stop and tell me what you have"_ gets that, rather than a notice reporting that the budget ran out. A tool call emitted after a denied extension ends the turn as budget exhausted and does **not** prompt to extend a second time, since a second prompt would let a denial buy an unbounded loop. Steering buys words, never budget (§5.4).

_Why a ceiling at all, given every consequential call is gated:_ **reads are ungated.** An agent can execute forty searches and file reads without touching the approval gate, and the first visible sign is whatever it concluded. Read-only does not mean free. Frequent limit-hits are information: the tools are too fine-grained or the task is too large.

### **5.4 Denial Semantics**

Bare denial terminates. Denial-with-reason continues the same turn under the same budget.

_Why bare denial is a full stop:_ a bare "denied" tells the model only that a path is blocked, so it tries an adjacent path — four near-identical proposals refused in sequence, which is the attention burn that destroys the gate (A5). Terminating also makes denial **loud**: an event you notice and can count, rather than something the model routes around invisibly.

_Why denial-with-reason stays inside the turn:_ a new turn would reset the action budget. Keeping it inside means a human who keeps steering still runs into the ceiling. This is why denials count against the budget.

## **6. Safety Model**

Three layers, in order of precedence.

### **6.1 Capability And Confinement**

Which tools exist for an agent at all, and where they may point. Most agents have no shell; some have no write access; each has only the tools its role requires. Set in configuration, immutable at runtime, fully enumerable without running anything.

For tool-only agents, confinement is enforced inside hand-written tool bodies — path rooting, read-only database connections, network allowlists. The model's cooperation is irrelevant.

For shell-holding agents it is enforced by OS permissions (A2), which is a stronger boundary because it does not depend on our code being correct.

**Shell confinement is OS permissions, not a path check.** `shell::run` runs each command as a dedicated OS user — `collegium-<agent-username>`, derived so it cannot be shared — via non-interactive `sudo`, never as the app's own user. Its numeric id is derived from the same username, never allocated on the fly and never read back off the agent's home: allocation depends on the order agents appear in configuration, so adding one agent could hand it the id an existing agent's files already carry, and a volume's ownership is not a fact every host preserves. Two usernames deriving one id would confine two agents together, which boot refuses by name. The deadline is enforced by `timeout(1)` running as that user, because the app cannot signal a process owned by another user. At boot the framework probes every shell-holding agent (`sudo -n -H -u <osUser> timeout 1 true`) and refuses to start if the OS user is not provisioned, so a misconfigured host fails loudly rather than on the first command; the probe carries the same `sudo` flags the real run does, or a host where one works and the other does not would pass boot and fail on the first command.

**`sudo` is never asked for a login shell.** With `--login` and a command, `sudo` does not exec the argv: it joins every argument into one string, escaping all but `[A-Za-z0-9_-$]`, and hands that to the target's login shell — which would expand a `$TOKEN` the approver read as a literal and fold a two-line command into one, breaking §6.2's guarantee that the approved bytes are the executed bytes. The login environment is established the other way instead: `--set-home` for `$HOME`, `bash -l` for the profiles, and the command in an argv slot of its own that no intermediate shell parses. Those users are provisioned by the container entrypoint, as root, before it drops privileges.

**Confinement from framework code is traversal, not a path check either.** The app root is not traversable by any agent OS user, and the plugin root is mounted beneath it, so framework code and operator-supplied plugin code alike are unreadable to the accounts `shell::run` executes as.

### **6.2 Approval**

The residual: irreversible, externally-visible, or shell actions block for consent (§3.7).

**Known limitation: approval verifies the call, not the content.** `workspace::write("notes.md", <900 words of confident nonsense>)` is a well-formed, in-bounds, correctly-scoped invocation. The tool has no opinion about whether the prose is true.

Two conditions therefore hold, or the gate becomes theatre:

1. **The read-only floor stays generous.** Gating pure observation multiplies prompt volume with zero risk reduction, and volume is what kills the gate.
2. **The prompt shows the payload in full.** A payload nobody can read is a payload nobody is checking. Where a payload exceeds what a single post can carry, the prompt shows a bounded prefix inline and the complete payload as an attachment — the approver sees the exact bytes rather than a rendering of them.

**The payload limit belongs to the substrate, not to us.** Mattermost's `MaxPostSize` is a server setting an administrator can change, so it is read at runtime and owned in one place behind the chat seam. Hardcoding it makes the gate silently wrong the day it moves, and raising it is not a remedy: it moves the cliff rather than removing it.

Shell commands are never attached, hidden, or truncated. They are presented inline and in full, and a command too long to present is refused — a shell command that will not fit in a post is itself the signal.

### **6.3 Reversibility**

There is no undo. `workspace::write` and `shell::run` act only inside confinement that holds nothing of independent value — the former within the agent's workspace directory, the latter as a dedicated OS user in its own home — so nothing there can be destroyed. Purpose-built tools that write to real systems are individually reviewed with fixed write targets; recovery on those paths is the underlying system's problem, not the framework's.

### **6.4 Callback Endpoints Trust The Network**

`POST /decisions`, `POST /commands`, and `POST /triggers` carry no authentication, by decision. Anyone who can reach `APP_PORT` can approve an agent action, issue `/collegium.kill`, or inject a trigger. The port must not be publicly routable — bind the loopback or a private interface and let Mattermost reach it over that path.

## **7. Failure And Recovery**

### **7.1 Failure Taxonomy**

Every way a turn can stop, and what the human sees:

- **Normal completion** — model emits no tool call. Ends. Visible as the final post.
- **Denial** — human clicks Deny. Ends. Prompt rewritten to a terminal state; the agent posts asking how to proceed.
- **Budget exhausted** — ten action attempts. Blocks on an approval to extend; denial ends the turn's actions, leaving it a final word only (§5.3).
- **Transport error** — timeout, 5xx, rate limit. Retried invisibly; nothing is shown unless retries exhaust.
- **Semantic error** — a call whose _shape_ the model got wrong: unparseable arguments, a missing or mistyped field, an unknown tool, a tool exception. Ends immediately. Error posted under the agent's name. A well-formed call whose _value_ the domain refuses is not this (§7.2).
- **Side-effect ambiguity** — a mutating call times out. Ends, with an explicit statement that completion cannot be confirmed.
- **Provider outage** — completion fails after retries. Ends. Failure posted under the agent's name.
- **Delivery failure** — the chat substrate refused a post the turn had to make. Ends, carrying the substrate's own reason. This is **not** a provider outage: naming the wrong system sends the reader to the wrong place. Where the refusal is total — an agent posting into a channel it does not belong to — there is no post to point at at all, which is A1's failure mode and must be loud in the operational record even though the channel stays silent.
- **`/collegium.stop`** — human command. Ends at the next iteration boundary. Stop notice posted.
- **`/collegium.kill`** — human command. Ends immediately; an in-flight tool may still complete.
- **Global halt** — hourly ceiling breached. All agents stop; prominent post; requires `/collegium.resume`.
- **Restart** — deploy or crash. All in-flight turns abandoned; one system-bot notice in the main channel.

In every case the channel lock is released. The queue drains into a fresh turn only when the exit allows progress — normal completion, denial, budget exhaustion, `/collegium.stop`, `/collegium.kill`. After a provider outage, semantic error, side-effect ambiguity, or delivery failure — and while a global halt stands — the queue is left standing: a fresh turn would inherit the same failure, and a drain loop bounded only by the hourly ceiling would halt the whole framework over one dead provider. A standing queue drains at the next human post, the next idle trigger flush, or the boot/`/collegium.resume` sweep — all human-visible moments. There is no retry timer: a slow retry loop is still the graceful degradation A4 rejects.

### **7.2 Retry Policy**

**Retry the transport, never the intent.**

Transport errors (timeout, 5xx, rate limit) are retried transparently: fixed small count, exponential backoff, invisible to the model, not counted against budget.

Semantic errors (malformed tool JSON, unknown tool, tool exception) terminate immediately. Feeding them back is the standard agent-framework pattern and it is the mechanism behind improvisation: a model told `tool 'send_mail' does not exist` will try `sendMail`, then `email_send`, then invent an argument shape — and if it stumbles onto something that works, it has succeeded at a call nobody intended.

**The line is shape, not validity.** A model that got a call's shape wrong is guessing at an interface, and terminates. A well-formed call whose value the domain refuses — a description over its cap (§3.6), a trigger not addressed to this agent (§4.2), a path outside the workspace (§6.1), a skill outside the agent's manifest (§3.5) — is a **result**: returned as the tool result, the turn continuing on its remaining budget. Such a refusal reaches nothing the agent was not already granted, and the retries are bounded because a refused invocation is still an invocation and still costs an action attempt (§5.3).

**A refusal never enumerates the accepted values.** The agent already holds its manifest, its caps and its tool schemas. Echoing the valid set back on failure converts something it was given into something it can guess at, which is the improvisation above arriving by a slower road.

**Never retry a call that may have committed a side effect.** If `mail::send` times out, we do not know whether the mail went. Retrying risks a duplicate; not retrying risks a silent drop. The turn terminates and posts the ambiguity explicitly. This is why `retryable` is a per-tool declaration: reads yes, mutations no.

### **7.3 Restart**

**Nothing resumes.** All in-flight turns are abandoned; every agent boots idle.

_Why not resume:_ tool calls are not idempotent, so re-running a turn risks sending the same email twice. Checkpointing instead produces intentions formed against a stale world — an approval clicked at 6pm executing a plan assembled at 9am, across a deploy, which is often exactly when the world changed.

On boot:

1. **Pending approval prompts are invalidated.** The post is edited to a dead state and its buttons removed, so a stale prompt cannot be clicked into either confusion or action.
2. **Backfill** runs per channel from the last recorded post ID forward (§8.2).
3. **Roster cache reconciles** against the API (§3.11).
4. **The system bot posts one boot notice** in the main channel, stating the downtime window and that in-flight work was abandoned.

**The downtime window is measured against the process, never inferred from activity.** A clean shutdown records its stop time and the notice is exact. A crash records nothing, so a periodic liveness stamp bounds it and the notice says _since last known alive_ — imprecise by at most the stamp interval, and honest about which of the two it is. Deriving the window from the last observed post instead would report a quiet channel as a day of downtime.

Queue state and outstanding triggers both survive a restart, so pending work is not lost to a deploy — it drains once channels go idle.

### **7.4 Loop Control**

Agent-to-agent mentions make unbounded chains possible: each turn is individually well-behaved and under budget while the chain runs until someone notices.

**Depth counter**, carried in the turn record and never shown to the model:

- Human-initiated turn → depth 0
- Trigger-initiated turn → depth 1 (a cron is not a human; unattended work is the dangerous kind)
- Agent-initiated turn → parent depth \+ 1
- Limit 10 (`turns.delegationDepthLimit`). At the limit, agent mentions in output are refused and the turn posts visibly: _"I would have asked a colleague but I've reached the delegation limit — someone needs to pick this up."_

**Depth bounds the chain only because §4.5 bounds its width.** Every turn may address at most one peer, so a chain stays a chain: ten levels is ten turns, not ten levels of a branching tree.

Enforcement is in the framework, not the prompt. Prompt-level constraints are advisory, and advisory constraints are what produced Hermes.

**Global ceiling: 250 turns per hour, framework-wide** (`turns.hourlyCeiling`). Breach halts all agents, posts prominently, and requires an explicit `/collegium.resume`. A halt invalidates pending approval prompts, as a restart does. While a halt stands, queues do not drain and triggers are not flushed — a trigger posted into a halted channel would strand, the exact outcome idle-gating exists to prevent. On clearing, `/collegium.resume` runs the same drain-and-flush sweep boot performs.

**`/collegium.resume` refuses only what it can objectively re-check.** A §3.10 topology violation is a fact about membership, so a halt raised by one stands until membership is fixed. A ceiling halt clears on the human's authority: the rolling window is reset and a fresh allowance begins. The halt exists to stop a chain and put a human in front of it; once they have looked, their judgement is the control the system was routing to, and a check that overrides it while offering no way to say _"I have seen it and it is fine"_ turns an emergency brake into a timer — which is not something a human can be accountable for.

_Accepted cost:_ a loop that trips the ceiling is handed a fresh allowance every time someone resumes it. The compensating controls are that the halt post is prominent, the resume is attributable, and the running count is in front of whoever clicks.

**The rolling window is durable; the halt flag is not.** Turn starts are counted from the store, from a persisted watermark that `/collegium.resume` advances, bounded to the trailing hour. The halt not surviving a restart is acceptable only because a restart breaks the loop that raised it; a crash-looping instance granting itself a fresh allowance every boot, with nobody deciding anything, would instead make the framework-wide number untrue. The ceiling is therefore re-evaluated at the first turn start after boot, and re-raises the halt if the window is still full.

### **7.5 Manual Intervention**

Both commands are **channel-scoped and apply to all agents in that channel.**

`/collegium.stop` aborts current turns at the next iteration boundary. The honest guarantee is _no further tool calls_, not _nothing happened_.

`/collegium.kill` abandons current turns immediately: the turn record is closed and the channel lock released. A tool already in flight may still complete and its side effect may still land — `/collegium.kill` is for a wedged process, and it accepts that ambiguity in exchange for immediacy.

Both post visibly. Any human in the channel may issue either, since stopping is always safe. Neither clears the queue: whatever was pending drains into the next turn.

**A command's own response is ephemeral**, so it never enters a channel as a post and cannot re-activate the agent it just interrupted — a `/collegium.kill` that wakes what it killed is not an intervention. The visible notice is separate: posted by the system bot where it is present, and under the agent's own account in a DM, where Mattermost admits no third party. Both are deterministic code, the second exactly as §3.2 permits for stop notices.

Either command also resolves a pending approval in the channel as **cancelled**: the prompt is rewritten to an invalidated terminal state, exactly as a restart does, and no follow-up posts. A cancellation is not a denial — denial statistics keep meaning that a human refused an action. This is how `/collegium.stop` reaches a turn parked on an approval, which is never between iterations and would otherwise be untouchable for days.

## **8. Persistence And Observability**

### **8.1 What The Human Sees**

**One status post per turn, edited in place** as the turn progresses. Tool calls are appended to it as they occur, so the post accumulates a readable trace of the turn rather than only showing current state. Mattermost supports post updates with a websocket edit broadcast, so connected clients re-render live.

**Each line names the tool and what the call is doing** — the URL navigated to, the path written, the command run — because a column of bare tool names says a turn was busy without saying what it did. Each tool renders its own one-line summary, choosing which of its arguments a supervisor needs; the line is capped in length and the untruncated arguments are always in `/collegium.trace`. The line is written before the call runs, so arguments the tool's schema will reject have no summary and the call is named alone.

_Why not stream every tool call as a separate post:_ a ten-call turn would produce ten posts of machinery around one post of substance, and approval prompts live in the same channel — noise in the supervision channel degrades the gate (A5).

Every memory write — and any eviction it causes — emits a disclosure line here (§3.6), the untruncated content of which can be viewed with `/collegium.trace`.

Queued messages are acknowledged with a 👀 reaction (§5.2). This and the typing indicator below are the only signals the framework emits without posting.

**A typing indicator shows while the model is generating**, using the substrate's own ephemeral typing signal. It creates no post and nothing durable. It is deliberately dark during tool execution and while an approval is pending: the status post and the approval prompt already account for that time, and an indicator held through a human's deliberation would claim work that is not happening.

**It also shows through the §4.4 window**, which is otherwise the one stretch where an agent has committed to answering and nothing says so. The signal expires on its own, so covering the window takes no bookkeeping — it does mean the window must stay well inside the substrate's expiry.

_Why this and not an eagerly-created status post:_ a turn that calls no tool should leave nothing behind but its reply (A5), yet the human who addressed the agent is owed some sign that it heard them. An indicator that expires on its own satisfies both.

### **8.2 What SQLite Holds**

**SQLite is authoritative for conversation content.** Context assembly reads only the database, never the Mattermost API on the turn path.

_Why a second copy at all:_ an agent's context is posts **interleaved with** tool calls, tool results, approval requests and decisions, and model metadata — its own turns' trace, never a peer's: tool results carry per-agent authority (§3.4), and raw traces are need-to-know even among humans (§8.3). None of that exists in Mattermost except as rendered text. Split across two stores, every context assembly becomes a merge-join across different clocks and ID spaces on every turn. One ordered store is a material simplification.

Stored: every observed post, every tool call and result, every approval request and decision, the trigger table, the queue state, and per-turn metadata (depth, action count, model, token usage). Tool identities are stored structurally (§3.4) — two columns where a scalar once held the name, the segment array inside JSON payloads — with a bare string reserved for what resolves to no tool: unresolvable model output, or a framework action like the budget extension.

Run in WAL mode with a busy timeout, since per-channel concurrency means concurrent writers.

**Backfill on boot is required.** Posts made while the process was down are absent from the store. Each channel is backfilled from its last recorded post ID forward, **per agent, using per-agent tokens** — never a privileged token, or the framework would import posts from channels the agent has no membership in and write them into a store the agent reads from. Backfilled posts never trigger a turn but are context-eligible, as history rather than missed requests.

**Repair path:** slash commands typed in the channel rather than a SQL console, so repair stays visible and attributable.

_Known wrinkle:_ post edits propagate during downtime via backfill but not during uptime, since there is no conflict resolution. Same event, different outcome depending on timing.

_Accepted losses:_ editing a post in the client does not correct what an agent believes; deleting a post does not redact it from context; a late-joining agent has no channel history before its join point.

### **8.3 Trace**

The complete tool trace — every call, arguments, and results — is retrievable via `/collegium.trace {post-id}`. **The response is ephemeral, visible only to the invoker**, because trace output contains file contents and email bodies verbatim, and everyone in a channel can also approve agents.

A trace carrying those payloads runs into the same substrate limit §6.2 does, and takes the same answer: where it exceeds what a single post can carry, it is delivered as an attachment, still ephemeral. One rule for content larger than a post, in both places it arises.

Reading traces is how the tool inventory gets tightened over time.

### **8.4 Command Surface**

Every command is namespaced under `collegium.`, so typing `/coll` autocompletes the whole surface and no generic word like `stop` is claimed team-wide:

- **`/collegium.trace {post-id}`** — full tool trace for a turn. Ephemeral.
- **`/collegium.forget {post-id}`** — remove a post from agent context. Posts.
- **`/collegium.reset {agent}`** — mark an episode boundary. Posts.
- **`/collegium.stop`** — abort current turns in this channel at the next boundary. Posts.
- **`/collegium.kill`** — abandon current turns in this channel immediately. Posts.
- **`/collegium.resume`** — clear a global halt.
- **`/collegium.queue {agent}`** — show pending depth and the oldest unprocessed post. Ephemeral.
- **`/collegium.triggers {agent}`** — list outstanding triggers. Ephemeral.
- **`/collegium.memory {agent}`** — inspect and prune an agent's memories. Ephemeral.

**The framework registers its own command surface at boot.** Each trigger above is reconciled against Mattermost. **Ownership is the creating account** — not the trigger word, and not the URL. A command this app created is its own to correct or remove; a command created by anyone else is never touched. An owned command is corrected when its URL has drifted, which is the redeploy case this exists for, and removed when its name has left the desired set. A name already held by a command the app does not own is a collision it cannot resolve, since Mattermost trigger words are unique per team: boot refuses, naming the command and its owner.

_Why not the URL:_ a command whose URL drifted is precisely the one needing correction, and URL-ownership would read it as foreign. _Why not the name:_ name-ownership would seize a `/collegium.stop` that legitimately belongs to another integration.

_Accepted cost:_ ownership follows the account, so rotating the app's token to a different one orphans the whole command surface — every name in the list becomes a foreign collision and boot refuses. That is loud and fixable by deleting the orphans, but a token rotation carries a deploy step with it.

_Why this is not left to provisioning, unlike §3.1:_ the target is the app's own callback URL, which only the app knows, and an administrator transcribing it once will drift silently on the first redeploy that moves the host or port. The failure is invisible in exactly the wrong direction — §7.5's intervention commands are unreachable at the moment someone reaches for them, and Mattermost surfaces it as an opaque client error rather than as an absence. This is the framework declaring its own entry points, not deciding topology; §3.9's rule that channel topology is declared rather than chosen is untouched.

Reconciliation requires authority to manage the team's slash commands. That authority is part of the app's declared configuration, and boot fails loudly if it is missing or reconciliation does not succeed. A framework that starts without its stop switch is worse than one that does not start.

## **9. Deliberate Non-Goals**

**No self-modification of instructions.** Agents cannot write skills, system prompts, tool definitions, schedules, channel configuration, or model selection. Memory is the sole exception.

**Fixed model per agent, no fallback chain.** A provider outage means the affected agents are dead for the duration, failing loudly.

**No queue bounds and no expiry.** Backlog grows without limit and nothing goes stale. Accepted for a system with a small number of internal users; revisit if a channel is ever genuinely swamped.

**No plugin ecosystem, and no plugin sandbox.** No registry and no discovery: what loads is named in `config.json` and mounted by the operator, and nothing is fetched. `@collegium/sdk` is published so a plugin can be written in a repository of its own, released with the framework and carrying its version, so the range a plugin declares names the deployment it was written for. A mounted plugin is compiled against the SDK the image carries — the version it declares governs its author's own tooling and nothing else, and boot refuses a plugin whose declared range that version does not satisfy. No isolation between framework and plugin: trust is total and deliberate (§3.14). Plugins do not depend on, extend, or communicate with one another; there is no lifecycle beyond startup — no hot reload, no enable/disable at runtime. Nothing in the system lets an agent write, install, configure, or enable a plugin — the prohibition on self-modification extends here unchanged.
