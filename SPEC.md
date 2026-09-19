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

The prompt is written in configuration, either inline or as a markdown file the configuration names beneath the resources root — the same seam a mail template is named through (§3.13). The second form exists because a prompt of any length is prose, and prose escaped into a JSON string is prose nobody reviews. Which form is used changes nothing downstream: the prompt is read once at boot and is a string from there on.

Each agent is a **Mattermost bot account** with its own access token, addressable as `@{username}`, shown with a `BOT` tag in the member list.

Agents are persistent colleagues, not task-scoped job runners. There is one instance of each agent, continuously; conversations are episodes in an ongoing relationship rather than independent invocations.

Provisioning is a deployment act, not a runtime one: before the app starts, a separate process reconciles Mattermost against the configuration — creating the team, the channels, one bot account per declared agent, and the access token each is addressed with. It converges; boot only refuses. Channel membership is what it does not converge: every bot joins the main channel, an agent joins the channel its mail arrivals are announced to, and the system bot joins every channel the configuration names, so that its notices (§3.2) have a place to land in each of them — nothing else. Who else belongs in a channel is set in Mattermost by the people who run it, and §3.10 is checked against that membership rather than against a second declaration that would have to agree with it. Its first act against a Mattermost it did not start is a refusal of its own: the server's settings must permit bot accounts, permit personal access tokens, and allow the callback address the app is reached on, and provisioning names each one it finds missing before creating anything — the last of the three otherwise fails nothing until the first approval button is clicked. The administrator it acts as is named by a personal access token where the server already exists, and by a password only where a fresh install has no account to sign in as. Nothing the running framework does creates an account or a channel, and **there is no runtime agent spawning**: every worker has a durable identity and its output is in a channel.

### **3.2 System Bot**

A separate Mattermost bot account used for all _mechanical_ output: triggers, boot announcements, interruption notices, stall notices (§7.6), and refusals.

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

**Posting is performed by the framework, not by a tool.** Text emitted alongside a tool call updates the status post and is transient. Text emitted with no tool call is the turn's final output and terminates the turn. Posting does not consume the action budget. A framework tool may return a post beside its result, which the framework then publishes under the agent's account from the tool's own template — the arrangement §3.7 already uses for an approval prompt, and how a work unit's state change becomes a post (§3.15). The tool decides the payload and the framework tells it when the post has landed, which is the only moment such a tool writes anything durable; it never reaches the chat server, and a plugin cannot return one.

### **3.4 Tool**

A hand-written TypeScript function exposed to the model with a schema. **One tool per action** — there are no tools whose behaviour branches on an `action` argument; a tool that would is two tools.

**A tool's identity is two segments, `[namespace, tool]`,** held structurally everywhere and rendered per audience: operators, approvers, config, traces, and errors see `mail::send`; the model sees `mail__send`. Each segment is lowercase snake_case with single underscores, which is what makes `__` an unambiguous join; the wire form is produced at request assembly — applied to the tool schemas and the replayed call history together, so the model never sees two spellings of one tool — and retained nowhere downstream of the provider response. Segments are rendered, never parsed, except at the config perimeter. A call arriving in the display form is resolved all the same: each agent's lookup map carries both spellings, rendered from the one identity at boot, because the framework's own approval posts put `mail::send` in that agent's window (§8.1) and a model reads its window. A call naming the tool segment alone — `send` — is resolved too, when exactly one tool the agent was granted carries that segment: a model drops a namespace far more often than it invents a tool, and the dropped namespace is not a guess at an interface. A segment two granted namespaces share names neither, and is not in the map. Admitting these spellings costs nothing §7.2 protects — the map holds only tools the agent was granted, so a name claiming anything else resolves to nothing and is answered as §7.2 says — and resolution stays a lookup. A bare segment can never collide with a two-segment spelling, since both of those contain a separator a segment cannot.

**A toolset is a namespace and everything that belongs to it**: its tools, the services they may reach, the settings they are configured by, the storage collections they own, the skills they ship. A toolset lives in the module that owns the capability — `mail/`, `memory/`, `web/`, `workspace/` — never in a central tool directory, and a framework toolset's namespace equals its module directory name. The one exception is `builtins/`: the framework's own small core tools that need no module of their own — a clock read, and whatever joins it — share that namespace rather than each owning a directory. Toolset declarations are inert data: a tool body names services by injection token and imports only their types, so the config perimeter derives the grant grammar from the declarations themselves and names survive into the type as a literal union (`'mail::send' | 'memory::read' | …`).

Each tool declares, alongside its description and parameters:

- **`approval`** — present means the tool **always** gates (§3.7): the function renders the payload the approver reads and cannot decline. What it renders must be the model's own arguments, the operator's own configuration, and the records in the toolset's own storage that the call acts on — never text a call the tool itself makes returns, which is unverified once anything external supplied it. A render therefore receives the read half of the storage handles `execute` receives, beside the settings, and may be asynchronous: an approver asked to delete a record reads the record as it is stored, not the model's description of it, and a model that named the wrong id is caught by the one person reading. It receives nothing else — no write, no service, no call out of the process — so the render stays deterministic: what the approver reads is a function of the arguments, the configuration and the store at that moment, never of anything a model or a network said. Whether a granted tool can act without a human is therefore answerable from config alone, and `/collegium inspect` marks it per tool so the answer needs no source read at all; a tool whose gate would depend on its arguments splits into two tools. A plugin tool must **state** the choice rather than imply it: the perimeter requires the key and accepts `null` for "this does not gate" (§3.14), because a framework toolset's source is read by whoever maintains it while a plugin's may live in another repository, where an omitted field cannot be told from a forgotten one.
- **`retryable`** — whether a timed-out call may be reported to the model as a plain failure (§7.2); false, the default, ends the turn as an unconfirmable side effect.
- **`budgetExempt`** — never billed against the action budget (§5.3). Framework toolsets only; the plugin perimeter rejects it.
- **`concurrent`** — may run alongside the other concurrent calls of the same completion (§5.1): a read that neither depends on nor disturbs what another call in the batch touches. A browser action is not one, since every action on the turn's one page follows the last.
- **`supersedable`** — a later result of any supersedable tool in the same turn makes this one stale (§3.8): a page the model acts on once and moves past.

Execution receives exactly the context its toolset declared: each declared service under its own name, `settings` (per turn, from the acting agent, §8-style resolution below), `storage` collections, and always `turn` — four facts: the acting agent, the channel, the triggering post (honestly nullable), and the turn id. Reaching anything undeclared is a compile error. A tool that creates a durable record returns its disclosure — body, description, reference, anything superseded — and the turn writes the event the trace reads back (§3.6).

Reads are generally ungated: search, fetch, read mail. Writes, shell commands, and anything externally visible carry `approval`.

**Authority parameters are never model-supplied.** Any argument determining _whose authority an action carries_ is fixed in tool settings — the `from` address on outbound mail, credentials for external services. The model may request that mail be sent; it cannot choose who it appears to be from — the mailbox and its credentials are fixed in the agent's mail settings and boot refuses a mail-granted agent without them (§3.13).

**Filesystem scope.** The `workspace` tools and `shell::run` are confined to the agent's own directories — the former by the workspace module's path confinement, the latter by OS permissions (§A2). They are not the _same_ directory, and both paths are stated in the preamble (§3.8) rather than left for the agent to discover by failing. Purpose-built tools may write to real systems (e.g., the application database) by their own internal logic; those are individually reviewed and their write targets are fixed in code, never chosen by the model.

**Reading the workspace is not a shell command.** `shell::run` takes model-authored text and therefore always gates; a read of the agent's own workspace does not need to. The `workspace` toolset's reads — `workspace::list`, `workspace::read`, `workspace::find`, `workspace::grep`, `workspace::stat` — take typed arguments and run in-process under the same path confinement as `workspace::write`, so there is no command string in which a second command could hide and nothing to classify: `find` cannot be handed `-exec` because no parameter exists to write it in. Each is ungated, because the confinement that bounds a write bounds a read of the same directory, and that directory is a narrower surface than `web::fetch`, which is ungated too. This is §3.4's own rule applied rather than a classifier: a tool whose gate would depend on its arguments splits into two tools, and the split is by _parameter shape_, not by inspecting a string. The shell's own directory is not reached by these tools: it belongs to the agent's OS user, the app cannot read it, and a read there is still a `shell::run` under the gate. That asymmetry is accepted — the workspace is the agent's file surface, the shell is a separate gated capability — and the preamble states both paths so the agent does not look for one tool's file with the other (§3.8).

**Shell output a result cannot carry is kept where the agent can read it.** A command's result carries a bounded prefix of each stream. Where the output ran past it and the agent holds `workspace::read`, the framework writes the whole capture to a file in the agent's workspace and names the file in the result, so the rest is a ranged read away rather than a second command under a second approval. This is the app writing its own directory with what the approved command already printed, not the shell reaching the workspace, so A2's separation stands. The capture is itself bounded, and says how much it dropped: a command that prints without end costs its own result, not the process every agent runs in. Only the most recent few captures are kept. An agent without `workspace::read` could not open the file, so it gets the prefix alone.

**Browsing.** The `web` toolset drives a real rendered browser (Camoufox) in a turn-scoped session: `web::navigate`, `web::click`, `web::fill`, and `web::hover` act against element refs from the latest snapshot, each action returning the page as markdown. A snapshot stamps an interactable CSS hides — a submenu that opens on hover, say — and marks its ref `hidden`, because such a ref is real but unactionable until something reveals it; `web::hover` is what reveals it, and an action attempted on one is a typed refusal naming that tool rather than an unexplained timeout. A tab the page opens for itself — a `target=_blank` link, a `window.open` — is closed and reported with its address, so the model opens it with `web::navigate` or `web::fetch` under the same rules as any other page; the session never moves onto a page nothing asked for. **It may submit forms and sign in where the task calls for it** — a great deal of the open web is unreachable otherwise, and a tool that could not search or authenticate would be a tool for reading front pages.

It is ungated all the same. The per-agent grant decides who may browse at all, the status post traces every action live, and a per-action or per-session approval would stall autonomous turns while approving only an entry URL — never the later actions that could transmit. This is the widest ungated surface in the system and is named as such rather than hidden: an agent that browses can transmit on its own authority.

What a fill types is shown like any other argument — in the status post, in the trace, and in the snapshot that follows — so nothing in this toolset is built to carry a secret. The one compensating control is scope, which **is enforced, not requested**: only `http(s)` URLs are opened, and only on the public internet — a `file://` URL, or a host naming this machine or its own network, is a typed refusal, because the browser runs as the orchestrator's OS user rather than inside the §A2 confinement that governs `shell::run`. The check runs again on every request the session makes, not only the address the model asked for — a redirect, a same-session link click, or a page's own sub-resource fetch is judged the same way, and the name is resolved and every answer judged, so a public URL that leads somewhere private does not reach it. The browser's requests leave through a proxy the framework runs on its own host, because the browser's own hooks never see a redirect hop: the proxy judges each hop and connects to the address that passed, so the browser never resolves a name itself, and `web::fetch` does the same in-process. It binds every address the browser opens, which is why a tab a page opens for itself is reported rather than followed.

Sessions are fresh anonymous contexts disposed at turn end — no cookies persist and no login outlives the turn that made it. robots.txt is not consulted: these are agent-driven reads at human pace, not crawling. Non-HTML resources (PDFs) are a typed refusal.

Beside the browser sits `web::fetch`: one plain HTTP GET, no session and no script, converted to markdown by the same rules and bound by the same URL policy — applied to every redirect hop, since the request runs in-process, with the hop's hostname resolved and every answer judged before the connection is made, and the connection pinned to the address that passed so a name that changes what it resolves to between the check and the connect reaches nothing new. It is the cheap first read for static pages; a page that yields nothing without JavaScript is a typed refusal naming `web::navigate`, and a textual non-HTML body (plain text, JSON, XML) is returned as it is.

`web::search` queries a search provider's API (Brave today) and returns ranked summaries — title, URL, snippet — never the pages themselves; reading one is `web::fetch` or `web::navigate`, under the URL policy above. The provider and its key are fixed in the agent's `web` settings, never model-supplied, and an agent whose settings name no provider is not offered the tool. Throttling is a result the model reads; refused credentials or an unanswering provider end the turn.

**Grants and settings are one config mechanism.** `agents.<username>.tools` lists namespaces or single `ns::tool` refs; a namespace grant covers tools added to that namespace later, so a plugin update can widen an existing grant with no config change — accepted deliberately, since installing a plugin is already a trust decision. Effective settings per toolset are `agentDefaults.toolSettings[ns]` merged shallowly with `agents.<username>.toolSettings[ns]`, then parsed against that toolset's own schema. Two generic rules replace every toolset-specific config refinement: settings for an ungranted toolset is an error, and a granted toolset whose merged settings fail its schema is an error — "mail requires a mailbox" is what the mail settings schema says, not a rule anyone maintains, and no toolset is named anywhere in the config module. A tool may declare that it works only under certain settings: a namespace grant leaves it out until the agent's settings enable it, and naming it by ref without them is a boot refusal.

**Core tools are framework machinery, not grantable capability.** `builtins::now`, `skills::load`, and `triggers::resolve` are in every agent's tool set — reading the clock, loading a skill the agent was already assigned or one of its references, clearing a trigger the framework itself raised — and naming one in config is an error; their namespaces never appear in config at all. A plugin cannot contribute one.

### **3.5 Skill**

A procedure stored in the repository as a directory: `app/src/skills/library/<name>/SKILL.md`, one per name in `BUILTIN_SKILL_NAMES`, with `description`/`title` frontmatter and an optional `tools` list. Supporting documents sit beside it under `references/<name>.md`, carrying the same frontmatter. A disk perimeter — parsed and Zod-validated at boot; a directory with no `SKILL.md`, a stray file beside it, a `references/` entry that is not one dashed `.md` document, a frontmatter key the schema does not name, or a skill directory no name list declares, refuses the boot. The list and the directory are two artifacts that must agree: the list exists because a directory listing cannot produce the grantable type, and boot is where they are held to each other.

Each agent's system prompt carries a **skill manifest**: the names of its assigned skills plus one line of description each. The full body is pulled into context on demand via `skills::load`, and one of that skill's references by the same call naming it.

**References are discovered, and their index is generated.** Reference names never reach config — they are not granted and not typed — so the library reads them off disk rather than declaring them, and `skills::load` appends the skill's reference index to the body it returns. This is §3.5's own invariant one layer down: an agent that has loaded a skill can never be unaware which references that skill has. An index the author maintained by hand would be a second artifact that must agree with the directory.

**A skill shipped by a toolset is namespaced like a tool** — `bookmark::saving-bookmarks` — and granted the same way; any toolset may ship skills, framework or plugin. Skill names keep the dashed convention of skill files, since a skill never reaches a provider as a tool name. Framework skills belonging to no capability keep bare names — `handing-work-to-a-peer` — which cannot collide, because every other skill carries a namespace. Granting a namespace's tools does not grant its skills, or the reverse. Core skills — `handing-work-to-a-peer` and `understanding-collegium` — are in every agent's manifest, are not grantable, and naming one in config is an error.

**A skill may name the tools its procedure calls**, as a namespace or a single `ns::tool` ref. Where it does, boot refuses an agent granted that skill without them: a procedure whose third step is a tool the agent does not hold is a turn that goes wrong in the middle, where the pairing was knowable before the process started. The list is the author's claim about the procedure, not a grant and not a filter — it reaches neither the model nor the tool registry, and a skill that names nothing is checked for nothing.

**Agents cannot write skills.** Skill authorship is an administrative act. The manifest is what makes on-demand loading safe: an agent may fail to judge _when_ a procedure applies (an ordinary error) but can never be unaware that it _exists_ (a structural blind spot).

Where a procedure is load-bearing, encode it as a single hand-written tool rather than describing it in a skill. Two shapes qualify: an ordering that must hold — check the database _before_ drafting, log _after_ sending — and a payload that must carry a particular part, such as the criteria a hand-off will be judged by (§3.15). A procedure in a prompt is a suggestion; the model will eventually skip the step, or the field, that mattered. What a skill is left with is judgement: whether the procedure applies at all, and which of the options in front of it to take.

### **3.6 Memory**

A `memories` table in SQLite, accessible to agents only through a tool, never through raw SQL. Each entry has a **description** (the trigger) and a **body** (the content).

- **Descriptions are loaded into the system prompt on every turn.** Bodies are loaded on demand.
- **Writes, revisions and deletes are ungated** — the single exception to A5.
- Entry count, description size, and body size are all capped, by the memory toolset's settings (§3.4). An over-length description or body is refused, never truncated; a write at the entry cap evicts the entry whose body was read longest ago, counting an entry never read from when it was written. Oldest-written would drop the foundational fact before the throwaway, and the store already knows which entries an agent keeps needing: reading a body is what records it.
- Every entry carries provenance: written-at timestamp and originating post ID. Entries are shown to the agent, in the trace, and to `/collegium memory` by a **reference** — the first eight characters of the id — which the store resolves back, refusing rather than guessing if it ever matched two.
- **A body is read back with its age** — how long ago it was written — above the text. A memory is what was true when it was written, and a model reasons about staleness from an age, not from a timestamp it would have to subtract. The age is in the tool result, not in the listing, so the prompt does not change as entries grow older.
- An entry is never edited in place. A revision — `memory::append` adds to an entry's body, `memory::replace` substitutes one passage of it — writes a new entry under a new reference and deletes the old one in the same step, so a correction reads as a correction in the listing an operator saw yesterday, rather than a stable reference quietly changing meaning. The description carries over; the provenance is the revising turn's.
- **A revision is one step, not a delete and a write.** Two steps leave the only copy of the body in the model's context between them: an agent that deletes the reference its own write just returned has lost the entry outright, and two turns revising one entry from two channels each rewrite a body the other has not seen, so one set of changes vanishes without a trace. A revision reads the stored body under the per-agent lock and the model sends only the change, which also means revising a long entry costs what the change costs rather than what the entry costs. A passage `memory::replace` does not find exactly once is refused as a result (§7.2) rather than guessed at; the revised body is held to the body cap like any write, and the entry count does not change.
- Memory is per-agent and never shared between agents.

_Why ungated:_ gating a memory write would block an entire turn on a triviality — an agent stalling for hours because it wanted to record a phone preference. Memory formation cannot sit behind human latency or it will not happen. Deletion inherits the exemption: an agent that cannot retract a fact it now knows to be wrong carries that fact into the system prompt of every later turn, and gating the retraction while leaving the write ungated would make the wrong state the cheap one.

_Compensating control:_ a write or a revision returns a disclosure — description, body, the record's reference, anything superseded — and the turn writes it into the trace. The status post carries the call itself, like any other tool call (§8.1): a memory's description is model-written prose of arbitrary length, and rendering it into the channel spends a supervisor's attention where `/collegium trace` and `/collegium memory` answer the same question on demand. This is **detection, not prevention** — the write has already happened.

Because turns are per-channel (§5.1), an agent may have concurrent turns writing memory. Memory writes, revisions and deletes therefore take a **per-agent lock**, since the entry cap is a read-modify-write and a delete landing inside one would cost that write an entry, and a revision is a read-modify-write of the body itself.

Memory is one of two paths by which information crosses channels — the other is search (§3.8). Something learned in channel A appears in the system prompt for channel B, or is found from it on demand. Both are intentional, both leave a trace, and the channel window itself is strictly channel-scoped.

### **3.7 Approval**

A blocking request for human consent, rendered as a post **under the agent's own account** with interactive buttons — the payload is model-proposed content, which §3.2 forbids the system bot to carry.

- **Approve** — the tool executes; the turn continues.
- **Deny** — the turn terminates; the agent posts asking how to proceed.
- **Deny with reason** — opens a dialog; the reason is fed back as the tool result and the turn continues under the same budget.

The prompt must show the full payload, not just the intent. Where a payload exceeds what a single post can carry, the prompt shows a bounded prefix inline and the complete payload as an attachment (§6.2). Once resolved, the prompt post is rewritten into a terminal state and its buttons removed.

**The prompt also carries what the framework knows and the payload cannot say.** Above the payload sit facts an approver would otherwise reconstruct by scrolling: which action of the turn's budget this is, and who asked for the work — by name, with a bounded excerpt of their own words, and only where a human asked; a trigger-initiated turn says so instead, because a trigger announcement's text was written elsewhere and an approval prompt is not the place to repeat it. Every word of that line is framework-authored from the turn record; nothing a tool returned and nothing a page, file or message contained ever reaches it. Nothing here is a gate, and the line may never refuse a call.

**There is no timeout.** The agent waits, for days if necessary, until a human answers. Work queued behind it accumulates without bound (§5.2). Since nothing expires and nothing chases, `/collegium approvals` (§8.4) is how a human finds what is still waiting without scrolling every channel for it.

**Who may approve: any human present in the channel.** There is no separate approver list, because a config-based roster would be a second access-control system that silently drifts from channel membership. Under presence-confers-authority there is exactly one such mechanism and it is managed by the client. The decision endpoint verifies the approver against channel membership; a decision from outside the channel is refused.

**There is no standing approval, and no session or per-run grant.** A gated tool gates on every call; nothing a human clicks makes the next call cheaper. This is not A5's frequency argument, which would if anything favour fewer prompts — it is §6.2's. A standing grant can only bind a call's _effect_: a tool, and the exact value of an argument naming what it acts on. It cannot bind the call's _content_, which is different every time. Every tool that gates today gates because of its content — the body of a mail, the text of a file, the bytes of a command — so a grant bound to `mail::send → alice@example.com` would authorise every future body sent to Alice, which is precisely the failure §1.1 records as nobody reading the payload. A tool becomes eligible only when its approval exists for its effect and its payload is exhausted by typed arguments a grant can bind exactly: a fixed-target write to a reviewed system, say. Such a grant would be scoped to the turn, never to a session or to disk, minted by the same button click that approves the call, and recorded in the trace like any other decision — so the authority stays enumerable and expires with the turn that earned it. None of Collegium's tools is eligible today, and the mechanism is therefore not built.

### **3.7a Ask**

A tool may declare `ask` instead of `approval`: a blocking request for a fact only a human has, rendered under the agent's own account like an approval, with the same no-timeout and channel-presence rules as §3.7, but resolved by a text answer rather than approve or deny. The answer is fed back as the tool's result and the turn continues under the same budget — there is no denial, because there is no action to refuse. A tool that would gate on consent uses `approval`; a tool that would solicit information uses `ask`; no tool declares both.

`ask::human` is the one framework tool that uses it: a question, and optionally up to six short answers offered as buttons alongside free text. It is not a substitute for approval — a tool that needs permission still gates, and the framework preamble tells the model so.

### **3.8 Context Window**

Each turn assembles context fresh from SQLite:

1. System prompt
2. Skill manifest (§3.5)
3. Memory descriptions (§3.6)
4. Peer roster (§3.11)
5. Tool definitions
6. **Channel window** — recent posts from the current channel, interleaved with the trace of this agent's own turns there (§8.2), walked backwards until a token budget is exhausted. The trace is never a peer's: an agent reads its colleagues through their posts alone — their replies and the notices posted under their names, never their status posts, which are their trace rendered.
7. **Earlier actions** — the last twenty lines of what this agent itself did in this channel before the window reaches, newest first, as the lines §3.8 already defines below. Its own turns only, never a peer's, and never back past the channel's episode boundary. Mechanical and derived: nothing is stored, nothing is summarised, and no model decides what was worth keeping.
8. **Open work** — the units this agent created or was assigned in this channel and has not closed (§3.15), oldest first: the reference, the counterpart, the age, the state and the one-line outcome. Read on demand for the rest, as a memory's body is.

**A post's attached files are named in the window**, one line each — name, type and size — whether or not anything can read them. A file an agent cannot read is a fact it states, not a fact it is spared: the substrate's most ordinary gesture is dragging a file into a channel, and an agent that answers the caption as though it were the whole message is wrong in a way nobody can see. Where the substrate reports ids without names, the line says so. The lines cost the window what they cost the model, so a post carrying twelve files is not free.

**The system prompt contains the agent's own prompt, the shared behavioral baseline, its optional personality, and the framework preamble.**

The preamble also states the one runtime fact about the filesystem an agent cannot otherwise see without failing: the directories its file tools point at. `workspace::write` and the workspace reads share one directory; `shell::run` runs as the agent's own OS user in a different one, and A2 makes those two mutually unreadable on purpose. An agent told neither path writes a file with one tool, fails to find it with the other, and reports a fault in the shell. Naming them grants nothing: confinement is path rooting and OS permissions (§6.1), neither of which depends on the model not knowing where it is, and A2's own claim is that an agent's surface is enumerable by reading config. The sentences are per agent and fixed for the life of the process, so they sit in the stable half of the prompt and cost the cache nothing.

_What is deliberately not there:_ the time, and the host's operating system, git state and processes. The time is a tool call, `builtins::now`, and not a line in the prompt, because a prompt that changes every minute is a prompt the provider's cache matches only up to the minute — the prompt-caching paragraph below is the reason. The rest is ambient state the agent was not granted, and a snapshot of it in the prompt is a read nobody approved — the §A2 surface widened by prose rather than by config. An agent that needs git state holds `shell::run` and asks for it under the gate.

The framework renders the behavioral baseline for every agent on every turn. It covers task intent, routine autonomy, scope changes, recovery from failure, proportionate verification, untrusted tool content, collaboration, progress updates, reusable memory — what is worth keeping, what is not, and what to believe when a memory disagrees with what the agent can see now — and disagreement. These are advisory instructions about how the model should work, separate from runtime facts and optional tone.

A personality adds a stance to that baseline. You select one of the framework's fixed personalities per agent or through `agentDefaults`. The baseline and personalities live in code and share the framework's version history.

The preamble describes runtime behavior in Simplified Technical English, using the deployment's actual budgets and exemptions. It covers posting, approvals, memory, peers, triggers, and the prohibition on self-modification. Every sentence states a runtime fact that holds whether or not the model complies. This separates the runtime guarantees from the advisory instructions of §1.1. Additional deployment guidance belongs in a personality or an agent's own prompt.

The token budget is a character-ratio estimate (~4 characters per token) behind a named seam. There is no tokenizer dependency.

An agent's budget is the one it declares, else the one `agentDefaults` declares, else a quarter of its model's context window. The framework records each model's window, and a model cannot be offered without one. The quarter leaves the rest of the window to the system prompt, the tool definitions, and the tool results a turn accumulates.

There is no threading. All posts are channel-level, so **context is pure recency**: no structural marker indicates where one piece of work ended and the next began. `/collegium reset {agent}` provides a manual episode boundary; context never reaches back past the most recent one. `/collegium clear` is the boundary for every agent at once, with the record removed rather than hidden (§8.5).

DM context follows the same mechanism as any other channel.

**The window's oldest entry holds still.** Once a window has been built, the next one for the same agent and channel starts from the same oldest entry for as long as everything since it fits the budget. When it no longer fits, the window is trimmed from the old end to three quarters of the budget and holds there again. Trimming exactly to the budget on every turn would move the oldest entry on every turn, and a provider's cache matches prefixes: a window whose start moves is a prompt that is never cached past the system prompt. The anchor lives in memory; a restart costs one cache miss.

**A tool result replays as what it was, not what it said.** A tool may return, beside its text, the line later turns see in place of it: a skill body replays as `[loaded skill x]` and a reference as `[loaded reference x/y]`, a page as its address and size, a long shell output or mail message as its size. The turn that made the call reads the text in full; a later turn reads the line and pays for the line, and can make the call again if it needs the text. Within a turn, a page is stale once the model has acted on it and moved to the next: past the two most recent, a supersedable result reads as its line for the rest of the turn. The trace keeps every result in full.

**A turn's own context is bounded too.** The budget above bounds what a turn starts with; its model's whole window bounds what it may accumulate, and the accounting covers the whole request — the system prompt, the tool definitions and every message, an assistant message's own arguments included. A turn whose results push it toward that window retires its stale pages first — under pressure a supersedable result reads as its line however recent it is, which is the rule above with its count relaxed rather than a second mechanism — but never the result it has just received and not yet read: a page retired before the model saw it defeats the read and invites the same fetch again. A single result that will not fit is cut to what fits, with a visible marker saying so, and the trace keeps the whole of it; a cut the model can see is the shape a shell output cap already takes, and a silent one is what §A4 forbids. A turn that still does not fit ends, saying so, because the alternative is a provider refusing the request and reporting a fault in the wrong system; the queue drains into a fresh turn, which starts from a window the budget bounds rather than from the results that overflowed. The trace keeps every result in full either way. The share left for the completion is a constant in code: a character-ratio estimate owes a real tokeniser some slack, and this is where that slack is spent.

**Prompt caching.** Stable instructions and the skill manifest come first; the memory descriptions, which change when the agent writes, come next; the peer roster, the open work (§3.15) and the earlier actions, which can change from one turn to the next, come last. The inference adapter marks these three system sections as separate cache boundaries for Claude and OpenAI models, so a block that changes every turn does not invalidate the cached descriptions ahead of it. Claude also enables automatic caching of the growing conversation. OpenAI retains implicit conversation caching with a 30-minute minimum lifetime. Claude uses its default five-minute lifetime. DeepSeek and GLM use their providers' automatic caching.

OpenRouter requests carry a stable, opaque routing key for each agent and channel, including requests using model aliases. OpenAI receives that key for prompt-cache routing too. Tool definitions have a deterministic order. Memory changes and history truncation can invalidate later cached content; caching never changes the recency window or preserves stale context. Provider minimum lengths and cache expiration still apply. `/collegium usage` reports cache reads when the provider supplies them.

**Search reaches what recency cannot.** `conversations::search` is a read over the post store — a case-insensitive substring over post text, optionally bounded by author and date — returning each match as post ID, channel, author, time, and text. It returns posts alone: never a trace, which is per-agent and need-to-know (§8.3), and never stored reasoning, which is replayed to the provider and to nothing else (§3.12). Nor does it return a status post or a notice, which a post records itself as when a turn authors it: the one is the trace rendered, the other the framework speaking under the agent's name. An agent's own replies are posts like any other, and are found. It is ungated, as reads are, and billed against the action budget (§5.3): the exemption is for context the framework already holds, and a search that can run forty times is the case the ceiling exists for.

Search is bounded exactly as the window is, applied per channel. It reaches only channels the agent is a member of **now**, asked of the channels module at query time rather than inferred from the store, since a post is recorded per channel and not per observer. It reaches back no further than each channel's own most recent episode boundary. A forgotten post (§8.4) is as absent from a result as it is from the window, or `/collegium forget` would be a lie.

**It never widens an audience.** A match surfaces in the current channel only if everyone who can read the current channel could already read its source. A public channel is readable by the whole team, so from one, search reaches public channels alone; from a private channel or DM it reaches public channels and any private channel or DM whose members include everyone present. The rule is one predicate in the channels module, which learns channel type and full membership the way it learns agent membership today (§3.11): from websocket events, reconciled on boot. A result names its source channel, so the model can see it is quoting from elsewhere.

_Why a structural rule rather than an instruction:_ a colleague knows not to repeat a private conversation in a public room; a model quoting a raw search result will do so by accident, and a result is verbatim where a memory is curated. The direction that remains is deliberate — in a DM, an agent recalls what was said in public. What was said in private and is wanted elsewhere crosses by memory (§3.6), where the human saw the disclosure at the moment it was kept.

**Search reaches what was said; the earlier-action lines reach what this agent did.** The asymmetry matters because a trace is per-agent and need-to-know (§8.3), so search cannot return one — which left an agent able to find a colleague's sentence from last week and unable to recall the file it wrote itself two turns ago. Memory does not close that gap and should not: it is curated, and the instruction is to keep principles rather than the incidental details of a finished task (§3.6). So the lines are carried mechanically instead, at one line each and a fixed count, which is the whole of what a summariser would have been asked to produce and none of its cost: no second model call on the turn path, no failure mode of its own, no stored interpretation of the channel to disagree with the channel. They say what the agent did, never what a result said. Reading a result again is making the call again.

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

**Each peer is listed with what it can do: its expertise, and the toolsets it was granted, by namespace** — `prospects`, `web`, `memory` — never its individual tools and never their settings. An agent that sees a colleague's name and nothing of its reach plans against capability it cannot see: a supervisor settles on a step no agent in the channel holds a tool to take, and offers it as an option, or accepts a worker's report of an environment limit for something the worker holds an unused tool for. The namespaces are the grants configuration states (§3.4), which A2 already makes enumerable by reading config, so listing them tells the agent nothing an operator could not. A single-tool grant lists its namespace, since the namespace is what says what kind of work the peer can do; the core namespaces every agent holds are left out, since they tell one agent nothing about another. The tools themselves stay each holder's own: a peer's schemas in the prompt would bill every turn for calls it can never make.

Membership is held in an in-memory cache maintained by Mattermost websocket events — never polled — and reconciled against the API on boot, since changes during downtime are invisible to the event stream.

### **3.12 Thinking**

Private reasoning is any intermediate model computation that is not emitted as user-visible output or as a tool invocation. Such reasoning:

- is never requested as part of an agent’s response;
- is never posted to Mattermost;
- is never included in an approval prompt;
- is never returned by `/collegium trace` or `/collegium inspect`;
- is never written to a log line.

It is stored in SQLite beside the completion that produced it, for one purpose: a thinking-mode provider refuses to continue from an assistant message whose reasoning it is not handed back, so the channel window replays it to the provider and to nothing else. It is stored in whichever form the provider hands it back — DeepSeek's text, OpenRouter's signed blocks — and returned in that form, unaltered, since a block whose signature no longer matches is refused. Where a model provider reports reasoning-token usage or similar accounting metadata, the framework may store the usage count.

**How hard a model reasons is configuration.** A model ref may state a `reasoningEffort`, in its provider's own vocabulary — DeepSeek's `none`, `low`, `high`, `max`; OpenRouter's unified scale — and the framework states it to the provider in the provider's own form. Where config states nothing, the provider's default stands: DeepSeek thinks at high effort, and a Claude model reached through OpenRouter does not think at all.

### **3.13 Mail**

An agent may act as **at most one email address**, fixed in its mail settings (§3.4) and resolved from the agent's identity. Which agents can send mail is therefore answerable by reading config alone. The mailbox boundary is enforced by the provider — an Exchange app registration scoped to that one mailbox, or an IMAP account that is that one mailbox — never by the framework asking politely.

**Two provider families sit behind one seam:** Microsoft Exchange Online, and generic IMAP/SMTP with password authentication. Domain code speaks only the seam; replacing a vendor rewrites only its adapter.

**Inbound is deterministic code, not an agent noticing.** A poll reads the mailbox on a configured interval and records one trigger row per arrival (§4.2); the system bot announces it when the channel is idle. On first connection the mailbox is read to its head and nothing is announced — existing mail is not news. After that nothing is missed, across restarts and extended downtime: every arrival is recorded durably _before_ the read cursor advances, so a crash in between re-reads the same page and a stable dedupe key makes the repeat a no-op. Backlog drains at a bounded rate — one page per poll, one announcement per idle moment — rather than all at once.

**An announcement shows the thread, not a wall.** The body is split at the boundaries the sender's client wrote — a quoted header block, an "On … wrote:" line, a forward banner — and rendered as one blockquote: the newest message first under its real headers, then each quoted message under the sender, date, and subject its boundary carried, verbatim, with a rule between them; opening the message in full shows the To and Cc a boundary carried as well. The split is deterministic code, never an agent's reading, and it is flat: nesting depth is discarded because the rendering has none. A boundary no rule recognises leaves the text where it is, still quoted, so an unknown client degrades to one segment rather than to dropped text.

**Handling an announcement marks the message read**, so the same item is not worked twice by a human and an agent. This rides the ordinary `triggers::resolve` path.

**Reading is ungated; sending is gated.** Listing, searching, and gathering a conversation return sender, subject, receipt time, and a short preview — only opening one message returns a body, and a body is never truncated by the mail tool; the one thing that may cut it is the turn's own context bound (§3.8), where a body that alone would overflow the model's window is cut to what fits, visibly, with the trace holding the whole. Bodies are presented as readable text whatever the sender's formatting. Attachments are described — name, type, size — and never opened; a request for their content is a typed refusal.

**Every send discloses what will leave**: the full recipient list, the subject, and the entire body, in the approval prompt (§3.7). Recipients are explicit arguments and there is no bcc field anywhere, so a recipient the approver cannot see is unrepresentable rather than merely disallowed. A reply stays in its conversation for the recipient because the provider threads it, never because the model managed it. **Drafting is not sending**: proposing wording in conversation touches no mailbox and needs no approval. A mailbox may name an HTML template beneath `RESOURCES_ROOT` in its settings; the body is then rendered from markdown into it, raw HTML escaped, so the approved text is still all the model contributed to what leaves.

**A send is never retried.** A refusal the server answered — nothing left — is an ordinary result the agent may act on. An outcome that cannot be established is reported as unresolved and ends the turn (§7.1), because feeding "unresolved" back to a model invites exactly the duplicate the rule exists to prevent.

**Boot proves every mailbox, and distinguishes what waiting cannot fix.** An announcement channel that is a direct message or that the agent does not belong to, and credentials the provider refuses, are boot refusals naming what is wrong. A mailbox that is merely unreachable is not: the system bot says so in the announcement channel and the framework runs, polling until it recovers and saying so again when it does — the same treatment the identical outage gets a minute after boot, rather than a crash loop whose only trace is the log.

Mail is optional: a deployment with no mailbox configured runs exactly as it did before mail existed, and a partially configured one is refused before the system runs, naming what is missing.

### **3.14 Plugin**

A unit of operator-supplied capability living outside the framework: a directory of TypeScript sources mounted into the deployment beneath the plugin root, named in `config.json`, compiled and loaded once when the process boots. The framework performs orchestration and carries no business domain — a deployment's own concerns belong in plugins, so the framework upgrades without ever occupying the same files as what a deployment added, and installing one never rebuilds the image.

**A plugin is a toolset (§3.4), and its layout is the declaration.** The directory's name is the plugin's namespace, its storage scope, and its skills' qualifier: one identity, stated once and restated nowhere. `src/config.ts` default-exports the config — the settings schema agents are configured by, and the storage collections the plugin owns. Every `src/tools/<name>.ts` default-exports one tool, named by its basename; every `src/skills/<name>/` is a skill directory in the §3.5 layout, granted as `<namespace>::<name>`. There is no entry module and no manifest of contributions — the framework synthesises at boot what the layout states. A plugin does not alter how the framework activates agents, orders turns, budgets actions, or resolves approvals — those remain the framework's, identically for every deployment. Contributions appear under the namespace — `bookmark::save`, `bookmark::saving-bookmarks` — and agents opt in per grant exactly as with framework capability: installing a plugin grants it to no one. Framework namespaces are reserved; `plugins[]` in config reduces to a list of names, each resolved as the directory of that name beneath the plugin root, and the plugin's settings live in the same `toolSettings` mechanism every toolset uses.

**Refused, never skipped; failures are startup failures.** A file the conventions cover either loads or stops the process from starting, naming the plugin and the file — a tool file whose basename is outside the tool-name grammar, a file under a convention directory the convention does not cover, a file missing its default export, a default export the perimeter schema refuses, a plugin that contributes neither tools nor skills, a package.json depending on anything but `@collegium/sdk` and `zod`, or failing to declare both, a declared dependency range the deployment’s own copies cannot satisfy, a directory the app cannot read, settings a granted agent supplies that the plugin's own declared schema refuses, a direct child of `src/skills/` that is not a skill directory, a skill directory naming no `SKILL.md`, a skill document or reference that does not parse, a configured grant nothing provides. Nothing about a plugin is discovered mid-turn, and nothing malformed is silently left out.

**A plugin tool no agent is granted is warned of, not refused.** Once grants resolve, boot logs a warning naming each such tool. The state is legitimate — installing a plugin grants it to no one, and a tool may be held back on purpose — so refusing it would make an operator grant what they meant to withhold. It is also exactly the state a forgotten grant leaves, and nothing else surfaces it: no turn fails, no call is refused, and the gap shows only when an agent reasons its way to a step it holds no tool for.

**Plugins are fully trusted; agents are not.** A plugin is operator-written code running with framework privilege — installing one is not different in kind from editing the framework, and the safety model constrains what an _agent_ may reach, not what an _operator_ may install. What a plugin decides is whether its tools gate (§3.7), by declaring `approval`, and what the prompt shows, rendered from the call's arguments, its settings and the records its own storage holds (§3.4) — a render that may take its time reading the store, and a synchronous one that reads nothing works as it always did; what it does not decide is whether its actions are seen — every plugin tool call is disclosed in the status post and recorded in the trace exactly as a framework tool's is (A5) — or how the framework budgets actions, which is why `budgetExempt` is absent from the plugin-facing type and rejected at the perimeter. A plugin's tool declares its gate explicitly — a render function, or `null` — and the perimeter refuses a tool that declares neither: trust in a plugin is total (§9), which is exactly why what it claims must be legible, and an absent field is not a claim.

**The boundary is structural.** A plugin imports `@collegium/sdk`, `zod`, and `node:` builtins — nothing else; every other bare specifier is a boot refusal naming the plugin, the specifier, and the file that imported it. Both packages are rewritten at compile time to the framework's own copies, so there is exactly one zod in the process by construction — the copies an author installs serve their editor and their tests and never run in the deployment — and each package is declared and its range checked against the deployment's version at boot, save for a `workspace:`/`catalog:` protocol, which names this repository's own copy rather than a range and so has no version to disagree with. A tool body returns plain text — or text beside a disclosure — and raises the only two failures it controls through the `err` its execution context carries: `invalidArguments`, returned to the model, and `unresolved`, ending the turn as an unconfirmed side effect. The rest of the failure taxonomy is the framework's to raise, and a plain throw is a semantic failure like any other (§7.1). What the SDK does not hand over, a plugin cannot touch; the framework refactors freely behind it.

**Storage without schema ownership.** A plugin persists durable records in the framework's own store, scoped to its namespace, validated against its declared collection schemas on write and parsed on read — the one qualified read perimeter, because rows may outlive the schema that wrote them. It owns no tables, no migrations, and no database client — adding a plugin adds no migration step, and a plugin cannot reach the framework's tables (or another toolset's rows) through its handle. A collection is a set of records: the declared shape plus an `id`, `createdAt`, and `updatedAt` the store stamps, names the declared schema may not use. A record is created through its schema, so defaults apply, under a caller-chosen id or a minted cuid2 — a taken id is refused, never overwritten — and is thereafter read, patched, or deleted by id; a patch is merged over the stored fields and the whole parsed again, so no patch leaves an invalid record. Beyond lookup by id, a collection answers one query grammar: an AND of conditions over the record's top-level scalar fields — equality, membership, or a case-insensitive substring on a string — with an optional limit, typed from the collection's own schema so an undeclared field is a compile error. The grammar is stated once, in core, with its in-memory evaluator; the store compiles it to SQL over the JSON payload, and a test holds the two equal. A storage write, like any durable record, can disclose itself by returning a disclosure (§3.4).

The example plugin (`plugins/bookmark`) exercises the entire contract — a gated tool, an ungated tool, settings, a collection, a skill with a reference — and is kept working by the test suite, so the contract cannot quietly rot. The SDK's `testing` entry builds the context `execute` receives over in-memory storage that validates and parses as the store does, so a plugin's tools are tested without a deployment; the example plugin's own tests use it.

### **3.15 Work Unit**

**A durable record of one thing one agent handed to another, in one channel.** A unit carries the outcome wanted, the criteria its creator will judge the result by, the context the assignee needs, its creator, its assignee, and its state: `assigned`, `blocked`, `review`, `done`, `cancelled`. It is created by `tasks::assign` and by nothing else. There is no unassigned unit, because a unit exists only because someone handed it over, and work nobody handed over is work an agent took on its own initiative (A3). Humans do not create units: a human's request is a post, and the agent that received it is accountable for it in the ordinary way. A question to a peer is a post too. A unit is for work handed over with a result someone will judge.

**Every state change is a post, and the post comes first.** The tool validates the change and renders the text; the framework publishes the post, under the acting agent's account, from a fixed template carrying model-authored fields — the same arrangement as an approval prompt, for the reason §3.2 gives — and tells the tool when the post has landed; only then does the tool write, and what it writes points at that post. A unit is therefore born from its own announcement: the row names the post that created it and the post that recorded its latest state, and a change the channel never saw is not disallowed but unrepresentable, because there is no post for the row to name. The order is chosen for the failure it leaves behind. Publishing and writing are two stores and are not pretended to be one write; a crash between them leaves a post with no unit, which the next report finds and says, and the creator assigns again — the same class of loss §4.4 accepts for an absorbed fragment, visible where it happened. The reverse order would leave a unit the channel never announced, which is the one disagreement a work unit exists to prevent. An assignment addresses its assignee and a report addresses its creator, so both activate through the ordinary path and §7.4 counts them exactly as it counts any other mention; a report is a return by the same mechanical test, unchanged. A close addresses nobody. This is the provenance a memory carries (§3.6), one level stronger, because a unit's states were announced in the channel rather than in a trace.

**The assignee cannot close.** `tasks::report` reaches `review` and `blocked` and nothing else; `tasks::close` reaches `done` and `cancelled` and is refused for anyone but the unit's creator. Done is the verdict of the agent that asked, after it has read the result: a report is a claim and a close is a judgement, and one agent never makes both about one unit. A unit in `review` its creator judges incomplete is handed back as a fresh unit with corrected criteria, or closed as cancelled with the reason — a second attempt is a second hand-off with its own post, rather than a state quietly rewound. The authority is read off the record rather than declared: creator and assignee are fields, so this relation is as unclaimable as the return in §7.4, and no agent holds a role. An agent is a creator in one unit and an assignee in another, which is why the relation is per unit and why there is no `lead` or `worker` anywhere in the configuration. `blocked` is for a blocker nobody in the channel can answer; an assignee held up by a question a person there can answer asks it (§3.7a) and keeps the unit.

**The open units are in the prompt, not in the scrollback.** Each turn's system prompt lists the units the agent created or was assigned in this channel and has not closed, oldest first: the reference, the counterpart, the age, the state, and the one-line outcome. The full criteria and context are read on demand with `tasks::read`, as a memory's body is (§3.6). This is what makes a supervisor's run tractable — §7.4 keeps a supervisor at depth 0 for however many units it hands out, and this is how it remembers them — and it is also how a stalled unit surfaces, since the age is in front of the creator the next time anything activates it, with nothing scheduling and nothing waking (A3). The units listed are capped by the toolset's settings; a unit is never truncated, the list is, and the remainder is stated as a count.

**A unit whose assignee runs out of context is reported blocked by the framework.** Long work exhausts an assignee's context before it reaches its report, and its output degrades on the way there, so the only warning is its own failure notice (§7.1) — which addresses nobody, while the creator, whose job is to close the unit, is never activated. When a turn ends as context exhausted while its agent is the assignee of a unit in `assigned` in this channel, the framework reports that unit `blocked` through the path `tasks::report` takes: the post under the agent's account, addressed to the creator, which activates it; the row written once the post has landed; refused as any report is where the turn already addressed a different peer (§4.5). The unit is the one whose assignment post started the turn, or otherwise the agent's only assigned unit in the channel; where it holds several and none started the turn, none is reported, since the framework does not guess which work a turn was doing. The reason is fixed text — _context exhausted_ — not the model's: the model has just run out of room, and a report written now would be written from the same degraded context. This is the framework speaking under the agent's account, as §3.2 permits, and nothing it retries: the creator decides what happens to the unit.

**An assignment is refused, not stripped, at a loop limit.** Where the turn stands at the §7.4 depth or chain-length limit, `tasks::assign` is refused before it runs and the agent is told why. Stripping the mention as the final-output path does would leave a unit assigned to a peer that was never activated, and the record disagreeing with the channel is the one failure a work unit exists to prevent.

**The unit is not a second approval surface.** Assignment, report and close are ungated. A hand-off is not more consequential than the mention it replaces, the assignee's own actions gate on their own merits, and a gate on the structured path while the plain mention stays free would make the worse path the cheaper one — the degradation A5 names, arrived at backwards.

## **4. Activation**

### **4.1 How Work Reaches An Agent**

All activation paths are Mattermost posts.

The alternative for scheduled work — the scheduler calling the runtime directly — is the subtle A1 violation. Everything downstream would still land in Mattermost, so it would look compliant, but the _occasion_ for the work would exist only in process memory: nothing to point at, and two ingestion paths through the runtime forever.

### **4.2 Triggers**

External events do not post directly. Deterministic code — cron, mail polling, webhook — evaluates its condition and, when it fires, writes a row to a **trigger table** in SQLite: source, target agent, target channel, a reference (sender, subject, ID, and where the source carries one, the full body), and status. Three intakes exist: `POST /triggers`, the mail watcher (§3.13), and the schedule ticker.

**A schedule is declared, never created.** An agent's configuration names its schedules by handle, each carrying a recurrence, a timezone, a channel the agent belongs to, and the text the system bot posts when it fires. Nothing about a firing is model-written: the announcement is the operator's own words, so it is the system bot speaking as §3.2 requires. A firing writes a row like any other source, and idle-gating decides when it is announced — a schedule that comes due while the channel is busy is announced when the channel next goes quiet, rather than being dropped or stacked. An agent can no more add a schedule than it can add a tool (§9); it can say in the channel that a weekly sweep would help, and a human adds one.

**A missed occurrence fires once.** The framework records, per schedule, the occurrence it last announced. A tick announces the most recent occurrence since that mark and then advances it, so a deployment that was down for a week announces one firing rather than seven, and a schedule declared this afternoon does not announce this morning. Recording precedes advancing, because a crash between them must cost a duplicate attempt the row's dedupe key absorbs, not a firing nobody sees. When a schedule's next occurrence is announced, the previous one is marked handled if the agent never did, so an outstanding list holds at most one firing per schedule.

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

**Absorption ends at the first action.** Once a tool has run or a post exists, discarding would throw away work that already had effects, so the turn stops absorbing and anything later takes the queue path. A **fold limit** (`activation.foldLimit`, three by default) bounds it from the other side: a human typing steadily reaches an answer instead of paying for one completion per sentence. Past that point the human's route into the running turn is `/collegium steer` (§7.5), which keeps the work already done and appends the correction, discarding only a completion still in flight — the one thing that has had no effect yet, and the same thing folding discards.

**Absorption is scoped to the turn's own author.** Unrelated conversation in the channel is recorded and reaches the next turn's window as it always did; it never costs a running turn its completion. Fragments arriving when no turn is absorbing — a different author, a repeated mention, a turn past its first action, an agent already busy on something else — are handled by the queue instead (§5.2), which drains them into one turn.

**Neither kind of folding is a queue.** The window occurs strictly before a turn exists, and an absorbed fragment is buffered in memory by the turn that took it. Nothing durable is created on either path, so a crash loses an absorbed fragment; the post is recorded, but nothing re-activates it. The window's **ceiling** matters for the same reason the fold limit does — without it, a human typing steadily never gets a response and the agent appears broken.

### **4.5 Multi-Agent Mentions Are Refused**

A post mentioning **two or more agents present in the channel** starts no turn and enters no queue. The system bot posts a mechanical correction: _address one agent per message_, and one sentence saying how to name an agent without addressing it — write the handle in backticks. A mention inside code is no mention in Mattermost's grammar (below), so a backticked handle neither activates nor counts here; an operator who wrote _about_ a colleague rather than _to_ it is refused all the same, and the refusal is what should carry the remedy.

Mentions of agents not present in the channel are inert text: an absent agent's socket never receives the post, so the harm this rule prevents — two concurrent turns on one task — cannot arise, and the post is handled as if the absent name were plain words. A DM therefore never trips this rule, since at most one agent exists there.

_Why:_ two agents working the same task produce two approval prompts for overlapping actions, and the second gets approved having half-read the first. Duplicate irreversible actions — both agents emailing the same contact — is a live risk. Picking the first-mentioned agent would be arbitrary, since mention order carries no intent and "one of you" designates nobody.

_Why, more consequentially:_ **this rule is what pins delegation width at one.** §7.4 bounds the depth of an agent-to-agent chain and says nothing about its branching factor. If a turn could address three peers, ten levels would be 3¹⁰ ≈ 59,000 turns and the hourly ceiling would be the only brake — an emergency stop, not a design. The depth limit bounds total work only because every turn can delegate to at most one colleague.

For agent-authored output the check happens at post time. The post is rejected and fed back to the model as a `user` message — _"post rejected: multiple agent mentions"_ — because the final-output branch carries no tool call for a tool result to reference. This is not a semantic failure: the model produced valid output violating a framework rule it cannot see, and one retry is cheap.

**A reply longer than a post can carry is rejected the same way.** The substrate's post limit is read at runtime (§6.2); a final output over it is fed back as a rejected post stating the limit and the reply's length, and the model answers again more briefly, or replies with the first part and says what remains. It is never truncated: a reply cut to fit reads as a whole reply that says less, which is the quiet degradation A4 forbids, and a reply the substrate refused would end the turn as a delivery failure (§7.1) over what is only a length. A post a tool returns (§3.15) over the limit is refused as its result, as any refused tool post is.

**The bound is per turn, not per post.** A turn addresses at most one peer, however many posts it emits: a second post naming a different agent present in the channel is refused exactly as a post naming two of them is. Where a turn's only addressing post was its final output the two spellings coincided, but a post the framework publishes for a tool (§3.15) is an addressing post too, and two of them would produce the two concurrent turns this rule exists to prevent without any single post ever naming two agents. The same peer addressed twice in one turn is one addressee, so handing a colleague two units of work in one turn stays within the rule. A refusal reaching a tool is a tool result; a refusal reaching final output takes the retry above.

**Two retries in a row, then the turn ends** with a deterministic notice under the agent's name. A rejected post spends one action attempt (§5.3), as §7.1 says of the truncated-output case it routes through this same loop: an invocation the framework refused is still an invocation, and the model was still asked to try again. The dedicated count exists all the same, because the budget's bound is the wrong one to rely on here — twenty-five rejected posts would reach the extension prompt with a number that says a turn worked hard rather than that it failed the same way repeatedly, which is exactly the gate degradation A5 names. The count is of rejections _in a row_: a tool call that runs between two of them resets it, since two rejections separated by work are two mistakes and not a pattern. Every cause shares the one count — the mentions above, a tool call written as prose, output cut at the limit (§7.1), a reply longer than a post, a call naming a tool the agent does not hold (§7.2) — because a model alternating between them is exhibiting one behaviour.

Agent mentions in transient status text are stripped before posting. Status text never addresses anyone.

**Detection and stripping share one grammar, and that grammar is Mattermost's.** What the framework treats as a mention is what the client highlights and notifies; anything else acts on a mention the human never saw, or ignores one they did, and A1 does not permit the framework to hold a second opinion about addressing. The two paths diverging is a defect class in its own right: a mention that activates a peer but survives stripping defeats both the width bound above and the depth limit in §7.4.

## **5. Execution Model**

### **5.1 One Turn At A Time, Per Channel**

**An agent executes strictly one turn at a time within a given channel.** While a turn is live — waiting on the model, executing a tool, or blocked on approval — that channel is closed to further turns for that agent. Other channels are unaffected.

The channel is therefore the concurrency unit. It is also the intervention unit (§7.5) and the context unit (§3.8). The cross-channel exceptions are memory (§3.6), search (§3.8), and the global rate ceiling (§7.4).

Acquisition of a channel lock must be a **synchronous compare-and-swap** — no `await` between checking availability and claiming it. Two debounce timers maturing microseconds apart would otherwise both observe an idle agent and both start turns.

Only one approval prompt can ever be live for a given agent in a given channel, which is what keeps approval resolution unambiguous.

**Within a turn, a completion's calls run in the order the model made them, except that a run of consecutive `concurrent` calls (§3.4) runs together.** Every call of such a run is admitted to the budget before the run starts, so the extension prompt still blocks in order and never twice at once, and the results are recorded in call order. A gated call is never concurrent.

### **5.2 The Queue**

A message addressed to a busy agent is **queued, not dropped**. The framework acknowledges it with a 👀 reaction on the post — not a reply, because a post per queued message would be noise in a channel where approval prompts also live.

An unaddressed fragment the running turn absorbs (§4.4) is neither queued nor acknowledged: the turn is already answering it, and the reply is the acknowledgement. The 👀 means "you are waiting", so it would be a lie there. A post that addresses the agent is always queued and acknowledged, however busy the agent is and whatever it is mid-way through.

**Drain, not pop.** When a turn ends on an exit that allows progress (§7.1) and the channel goes idle, everything queued for that channel is consumed by a single new turn. Ten fragments queued during a long turn become one turn, not ten.

**What the finished turn already read is consumed, not drained.** A post can be queued and still be read by the turn it queued behind: it arrives while that turn's lock is taken but before its context is assembled — two posts landing together, the second behind a turn the first started — and the window that turn assembles holds it (§3.8). When such a turn completes normally, the window its context was last assembled from reached the earliest post queued for it, and nothing has been recorded in the channel since that assembly began — the agent's own posts, status posts and the system bot's aside — the entry is consumed and no turn starts: every queued post was already in the store the window was read from, the window runs back unbroken from the newest post past the earliest queued one, and a second turn would assemble the same window and say the same thing again, at whatever the agent's model costs. A post recorded after the assembly began was never read, whether or not it addresses the agent, and the entry drains exactly as before; the test is by when a post reached the store rather than by the time Mattermost stamped on it, because a post recovered after a reconnect carries an older stamp than the posts around it. Any other exit drains as before too, since a turn that stopped, was killed, or ran out of budget or room did not finish answering what it read. Folding (§4.4) is untouched: it decides what a turn reads before it acts, and this decides only whether another turn is owed afterwards.

**The drain is visible even when context is not.** The queue holds pointers and content arrives through the channel window, which walks back only until its token budget is exhausted. When the window cannot reach back as far as the earliest unprocessed post, the draining turn's status post says how far back context actually reached — detection, not prevention, the same posture as memory-write disclosure (§3.6). What the window could not reach, the agent can search for (§3.8).

**The queue holds pointers, not content.** Context is assembled from the channel window (§3.8), which already contains every recent post. The queue therefore stores one row per (agent, channel): that unprocessed work exists, and the earliest unprocessed post ID, where context must reach back to. It also records when it last changed, so that consuming it (above) never removes a post queued after the check was made. Draining clears the flag; the content arrives through the normal context path. Delete the queue and it rebuilds from posts, which is why it does not violate A1.

**Nothing from the system bot is queued.** Triggers are governed by idle-gating (§4.2) instead.

**The backlog is unbounded and nothing expires.** If approvals are slow, work accumulates behind them indefinitely. This is accepted: the alternative is silently discarding work, and the failure mode of an unbounded queue is visible — a channel that has been busy for a day is obviously busy.

### **5.3 Action Budget**

**Twenty-five action attempts per turn** (`turns.actionBudget`), **unless the agent declares its own** (`agents.{name}.actionBudget`). An action attempt is one model-emitted tool invocation, _including invocations denied before execution._ Not counted: framework transport retries, framework posting, and the tools declared budget-exempt (§3.4) — `skills::load` and `memory::read`, the exemption being for loading context the framework already holds. A plugin cannot declare one.

On exhaustion the agent posts what it has and requests approval to extend. Approving grants the agent's budget over again and preserves accumulated context. Extensions are unbounded in number, but each prompt carries the running count — _extension 4; 100 attempts so far_ — because the human in the loop is the control, and the control needs the number.

_Why the budget is per agent:_ the number is a statement about a role, not about the framework. An agent whose unit of work is a hundred ungated reads — a directory scraped, cross-checked, and recorded in batches — either pays that number once, in configuration, or pays it as four extension prompts per unit answered by a human who has stopped reading them, which is the gate degradation A5 names. A declared budget is enumerable by reading config, the same property every other grant has (§6.1). It buys an agent nothing it was not granted: every gated call still blocks, and the extension prompt still stands past the declared number. The default stays low because the default agent is a conversational one, and a budget nobody stated should stay the one that makes a runaway turn visible early.

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

1. **The read-only floor stays generous.** Gating pure observation multiplies prompt volume with zero risk reduction, and volume is what kills the gate. This is why the workspace has read tools beside `workspace::write` (§3.4): a read expressed as typed arguments is an observation, and gating it would buy nothing the path confinement does not already hold.
2. **The prompt shows the payload in full.** A payload nobody can read is a payload nobody is checking. Where a payload exceeds what a single post can carry, the prompt shows a bounded prefix inline and the complete payload as an attachment — the approver sees the exact bytes rather than a rendering of them. A payload shown as code is fenced with more backticks than any run inside it, so no payload can close its own fence: text after an early close would render as Markdown, where a link shows its words and hides its target.

**The payload limit belongs to the substrate, not to us.** Mattermost's `MaxPostSize` is a server setting an administrator can change, so it is read at runtime and owned in one place behind the chat seam. Hardcoding it makes the gate silently wrong the day it moves, and raising it is not a remedy: it moves the cliff rather than removing it.

Shell commands are never attached, hidden, or truncated. They are presented inline and in full, and a command too long to present is refused — a shell command that will not fit in a post is itself the signal. The §3.7 context line shares that post, so it shortens the longest presentable command by its own length; accepted, because a command needing the post's last bytes is already near the signal, and a refusal is a result the model can act on.

### **6.3 Reversibility**

There is no undo. `workspace::write` and `shell::run` act only inside confinement that holds nothing of independent value — the former within the agent's workspace directory, the latter as a dedicated OS user in its own home — so nothing there can be destroyed. Purpose-built tools that write to real systems are individually reviewed with fixed write targets; recovery on those paths is the underlying system's problem, not the framework's.

### **6.4 Callback Endpoints Trust The Network**

`POST /decisions`, `POST /commands`, and `POST /triggers` require a shared secret on every request, in addition to trusting the network — by decision, not by necessity. The port must still not be publicly routable — bind the loopback or a private interface and let Mattermost reach it over that path. The secrets exist because that binding controls host exposure, not exposure within the deployment's own network: anything else sharing a docker-compose network with the app, for instance, could otherwise reach `APP_PORT` without ever crossing the host boundary. There are two, separated by the authority each confers. `CALLBACK_TOKEN` is Mattermost's: the command route carries it as a bearer header from the plugin, and a decision route, whose request Mattermost assembles from a button's context and a dialog's state — which the substrate stores and, for the dialog, hands to the deciding user's client — carries a signature the token produces over that one approval instead, so the secret itself is never written into a post. `TRIGGER_TOKEN` is a trigger sender's, carried as a bearer header on the trigger route and accepted nowhere else: a webhook integration holds a credential that can announce work and cannot approve an action or stop a turn. It is optional, and its absence closes the route rather than opening it. Anyone who can reach `APP_PORT` **and** knows `CALLBACK_TOKEN` can approve an agent action or issue `/collegium kill`; anyone who can reach it and knows `TRIGGER_TOKEN` can inject a trigger, and nothing more.

## **7. Failure And Recovery**

### **7.1 Failure Taxonomy**

Every way a turn can stop, and what the human sees:

- **Normal completion** — model emits no tool call. Ends. Visible as the final post.
- **Denial** — human clicks Deny. Ends. Prompt rewritten to a terminal state; the agent posts asking how to proceed.
- **Budget exhausted** — the agent's action budget spent (§5.3). Blocks on an approval to extend; denial ends the turn's actions, leaving it a final word only (§5.3).
- **Transport error** — timeout, 5xx, rate limit, a completion the provider itself interrupted mid-stream, or one that arrived malformed (§7.2). Retried invisibly; nothing is shown unless retries exhaust or a rate limit asks for a longer wait than the policy allows (§7.2).
- **Output cut at the limit** — the provider stopped the completion at its output ceiling. Not output, since the model never finished, and not a failure: it is fed back as a rejected post (§4.5), spending one attempt, and the model answers again more briefly. Like every rejected post it is bounded twice, by the budget and by §4.5's own count of consecutive rejections.
- **Semantic error** — a tool that threw, or a completion still malformed once its transport retries are spent (§7.2). Ends immediately. Error posted under the agent's name. A call whose arguments the tool's schema refuses — a missing or mistyped field — is not this, and nor is a well-formed call whose _value_ the domain refuses: each is a result the model reads (§7.2). Nor is a call naming a tool the agent does not hold, which is answered with the tools it does (§7.2). A call whose argument text never parsed at all is forgiven once (§7.2) and ends the turn here on the second. Output the framework refuses to post, twice in a row, ends the turn here too: the model produced valid output breaking a rule it cannot see, and after two corrections the next one is not going to land.
- **Side-effect ambiguity** — a mutating call times out. Ends, with an explicit statement that completion cannot be confirmed.
- **Provider outage** — completion fails after retries. Ends. Failure posted under the agent's name, naming the transport cause the runtime reported — connecting timed out, the provider went quiet, the provider interrupted the completion, the address did not resolve, the connection was refused or reset, the TLS handshake failed, the provider rate-limited the request (with the wait it asked for, where it gave one), or another HTTP status — as one fixed phrase per cause, never the runtime's or the provider's words (§3.2). The distinction between _connecting_ and _responding_ is the one an operator acts on: a provider that accepts the connection and never answers is a fault in one model or endpoint, not in the network.
- **Provider rejection** — the provider refused the request itself: a 4xx other than a rate limit, most often a request the framework built wrong; or it filtered the completion. Ends. Never retried, since the same request would be refused again. Failure posted under the agent's name, naming the status code — 401 as a refused credential, 402 as an exhausted balance and 403 as a permission or moderation refusal, any other status by number alone, each one fixed phrase per class and never the provider's own wording. A refusal for the request's _length_ is not this (below): naming the provider there sends the reader to a status page for a fault in the turn.
- **Context exhausted** — the turn accumulated more than its model's window can hold, either measured by the framework before a request or reported by the provider as a refusal for length. Ends. Posted under the agent's name, saying the turn ran out of room part-way through and pointing at the trace — or, where the starting context itself did not fit, that the context budget and the model disagree, which is configuration rather than anything the turn did. Never retried. A turn working a delegated unit also reports that unit blocked, so its creator hears of it (§3.15). The queue drains: exhaustion is a fact about one turn's accumulation, not about the channel, and a fresh turn starts from a window the budget bounds. The configuration case would fail the fresh turn too, and may: the drain below is bounded to one per human post, so a misconfiguration is loud twice and then stands.
- **Delivery failure** — the chat substrate refused a post the turn had to make. Ends, carrying the substrate's own reason. This is **not** a provider outage: naming the wrong system sends the reader to the wrong place. Where the refusal is total — an agent posting into a channel it does not belong to — there is no post to point at at all, which is A1's failure mode and must be loud in the operational record even though the channel stays silent.
- **`/collegium stop`** — human command. Ends at the next iteration boundary. Stop notice posted.
- **`/collegium kill`** — human command. Ends immediately; an in-flight completion is aborted, an in-flight tool may still complete.
- **Global halt** — hourly ceiling breached. All agents stop; prominent post; requires `/collegium resume`.
- **Restart** — deploy or crash. All in-flight turns abandoned; one system-bot notice in the main channel.

**A failure post names what the turn may already have changed.** Where a turn ends on a semantic error, side-effect ambiguity, provider outage or rejection, context exhaustion or delivery failure after calls to tools not declared `retryable` — which §7.2 reserves for reads — ran to completion, the post reporting the failure names each such tool and how many times it ran, and tells the reader to check their effects before running the work again. The natural reading of a failure is that nothing happened, and a turn that wrote before it died makes that reading wrong in a way nobody sees until the duplicate. The names are the framework's own rendering of the tools, never model text (§3.2). A denial, a stop, a kill and an exhausted budget carry no such line: a human caused or watched each of them, and the status post already lists every call — and names the same calls on its closing edit, on every exit (§8.1).

In every case the channel lock is released. The queue drains into a fresh turn only when the exit allows progress — normal completion, denial, budget exhaustion, context exhaustion, `/collegium stop`, `/collegium kill`. After a provider outage or rejection, semantic error, side-effect ambiguity, or delivery failure — and while a global halt stands — the queue is left standing: a fresh turn would inherit the same failure, and a drain loop bounded only by the hourly ceiling would halt the whole framework over one dead provider. Context exhaustion is on the first list and not the second because a fresh turn does not inherit it: what overflowed was one turn's own results, and the window the next turn assembles is bounded by its budget. Where the starting context itself did not fit, the fresh turn fails the same way, and the one-drain bound below is what makes that a loud fault rather than a loop. A standing queue drains at the next human post, the next idle trigger flush, or the boot/`/collegium resume` sweep — all human-visible moments. A human post that arrived while the failed turn ran is that next post: it was acknowledged with a 👀 (§5.2), so the queue drains into a fresh turn the moment the lock is released rather than waiting for a post that may never come. One drain per human post keeps this bounded — a fresh turn that fails again has nothing new behind it and stands. A peer's mention earns no such drain; it waits for a human. There is no retry timer: a slow retry loop is still the graceful degradation A4 rejects.

### **7.2 Retry Policy**

**Retry the transport, never the intent.**

Transport errors (timeout, 5xx, rate limit, a completion interrupted mid-stream) are retried transparently: a fixed count, exponential backoff with jitter, invisible to the model, not counted against budget. The jitter is there because several agents usually share one provider key, and retries that fall in step collide again. **A rate limit that says how long to wait is waited out as asked** — `Retry-After`, in seconds or as a date — up to the policy's longest single wait. One asking for longer ends the turn at once as a provider outage naming the rate limit and the wait: a wait that long is the silent stall A4 rejects, not a retry. A request whose turn has been killed is never retried: its turn is gone, and a retry would spend a full prompt on nobody.

**A malformed completion is retried as transport.** A stream chunk that does not parse, a call with no id or no name, a reply carrying neither text nor a call: each is a delivery the provider got wrong, not an intent the model formed, and nothing has acted on it, so asking again is retrying the transport — the same request, the same count and backoff, and a completion that is still malformed once they are spent ends the turn as a semantic error. The argument text of a single call is the one exception, forgiven inside the turn instead (below), because the rest of that completion arrived sound and would be thrown away by a retry.

**Every completion streams, under an idle timeout.** The inference timeout (`inference.timeoutMs`) bounds how long the provider may send nothing — the connection, the first token, or any later one — not how long the completion takes. A model that thinks for ten minutes and keeps streaming is served; one the provider has stopped serving is cut and retried. A total deadline could not tell the two apart, and would cut the thinking completion three times over before giving up.

**A tool that throws ends the turn.** Its body failed in a way it did not return as a result, so whether it acted is unknown and nothing the model could change about the call is known to help.

**Arguments the schema refuses are answered, not ended on.** A call for a tool the agent holds, whose arguments parse but fail the tool's schema — a missing field, a mistyped one, a value outside an enum — returns one result naming what the schema refused, and spends an attempt (§5.3). The call reaches neither its gate nor its body. A model that misread an interface corrects itself from the refusal far more often than it improvises around it, and what reshaping could reach is bounded by construction: every reshaped call is validated against the same schema, gated as before and billed as before, so no sequence of guesses reaches anything the agent was not granted, and the budget is what stops a model that never converges.

**A name that resolves to no tool is answered, not ended on.** A call naming a tool the agent does not hold, under every spelling §3.4 admits, returns one result: the name it used, and the tools it can call, by the names it calls them. It spends an attempt (§5.3) and counts toward §4.5's count of rejections in a row, so a third wrong name in a row ends the turn as a refused output does. Misnaming a tool is the ordinary error of a long context, not a probe of an interface, and ending the turn over it ended whole supervised runs over a typo. A name reaches no boundary to probe either: resolution is a lookup in a map of the agent's own grants (§3.4), so no guess, however many, calls anything the agent was not already granted.

**A value the domain refuses is a result too.** A well-formed call whose value the domain refuses — a description over its cap (§3.6), a trigger not addressed to this agent (§4.2), a path outside the workspace (§6.1), a skill outside the agent's manifest (§3.5) — is returned as the tool result, the turn continuing on its remaining budget. Such a refusal reaches nothing the agent was not already granted, and the retries are bounded because a refused invocation is still an invocation and still costs an action attempt (§5.3).

**Argument text that never parsed is not a shape the model chose.** A call for a tool the agent holds, whose arguments did not parse as JSON at all, is a byte-level accident — a stream cut short, an escaping slip inside a long field, a provider's serialiser dropping a chunk — not a model guessing at an interface. As with a schema refusal, the retry reaches nothing the agent was not already given. The framework already treats the sibling case this way, since a completion the provider cut at its output limit comes back for a shorter attempt (§7.1) rather than ending the turn. Such a call therefore returns one result — that the arguments were not valid JSON and the call did not run, naming no parameter and no type — and spends an attempt like any other invocation. **The second such call in the same turn ends it.** One is a mistake corrected; two in one turn says this call's arguments are not surviving the trip, and a third completion would be spent on the same accident. The tool body never sees the broken arguments, and the provider's raw text is never read back to the model: the trace keeps its first two hundred characters and nothing else does.

**A refusal never enumerates accepted values the agent was not already shown.** It holds its manifest, its caps and its tool schemas; a domain refusal — a skill outside the manifest, a trigger not its own — names what was refused and never lists what would have passed, because a valid set echoed back on failure turns a boundary into something to guess at. Two refusals restate a set the agent already holds, and are exceptions for that reason alone: a schema refusal may quote the tool's own schema — an enum's options — back to the call that misread it, and the unknown name above lists the tools the agent holds, by the names it calls them. Neither converts anything into a guess; each restates, where the mistake was made, what the model was given.

**Never retry a call that may have committed a side effect.** If `mail::send` times out, we do not know whether the mail went. Retrying risks a duplicate; not retrying risks a silent drop. The turn terminates and posts the ambiguity explicitly. This is why `retryable` is a per-tool declaration: reads yes, mutations no.

### **7.3 Restart**

**Nothing resumes.** All in-flight turns are abandoned; every agent boots idle.

_Why not resume:_ tool calls are not idempotent, so re-running a turn risks sending the same email twice. Checkpointing instead produces intentions formed against a stale world — an approval clicked at 6pm executing a plan assembled at 9am, across a deploy, which is often exactly when the world changed.

On boot:

1. **The status post of every abandoned turn is closed**, in the channel the work was asked for, under the agent's own name: the trace it accumulated stays and its working line becomes an abandoned one. A turn that called no tool has no status post and leaves nothing behind, as it would have on any other exit. The notice in the main channel says the framework restarted; the turn's own post is what says which work that cost. A chat edit that fails is logged and boot continues — supervision degrades, the boot does not.
2. **Pending approval prompts are invalidated.** The post is edited to a dead state and its buttons removed, so a stale prompt cannot be clicked into either confusion or action.
3. **Backfill** runs per channel from the last recorded post ID forward (§8.2).
4. **Roster cache reconciles** against the API (§3.11).
5. **The system bot posts one boot notice** in the main channel, stating the downtime window, that in-flight work was abandoned, and how much of it was queued again (below).

**The downtime window is measured against the process, never inferred from activity.** A clean shutdown records its stop time before it tears anything down, so a teardown that hangs until the container is killed still leaves the notice exact. A crash records nothing, so a periodic liveness stamp bounds it and the notice says _since last known alive_ — imprecise by at most the stamp interval, and honest about which of the two it is. Deriving the window from the last observed post instead would report a quiet channel as a day of downtime.

**Boot also verifies what it is about to trust.** For every model at least one configured agent names, the framework issues one minimal completion for it through its provider before it starts serving Mattermost events, and refuses to start if the provider rejects it as unauthorized, naming the model and the agents it strands — a bad or revoked key, or a key with no access to that model, fails loudly during deploy rather than on an agent's first turn, the same posture §6.1 already takes for a shell-holding agent's OS user. The probes share one short deadline, so a provider that accepts the connection and never answers cannot hold the deployment at boot; an answer that is neither acceptance nor refusal within it — a timeout, a dead provider, a malformed reply — is recorded in the log as unverified, never as verified, because a check that could not run must not read as a check that passed (§A4).

Queue state and outstanding triggers both survive a restart, so pending work is not lost to a deploy — it drains once channels go idle.

**An abandoned turn that had not acted is queued again.** A turn to which no completion had yet come back when the process stopped changed nothing — at most it had read its window — so the post that started it goes back into the queue, exactly as a failed exit leaves its post standing (§7.1), and the boot sweep drains it into a fresh turn. This is not resumption: the fresh turn assembles its context from the channel as it stands after the restart, and nothing it inherits can happen twice. A turn with a completion recorded is abandoned as before, since the completion is recorded before any call it carries is admitted and before a reply it carries is posted: the turn may have called a tool, whose effect may not survive being done again, or posted its answer, which a fresh turn would post a second time. A turn a trigger started is not queued again, since nothing from the system bot is queued (§5.2). Without this, a deploy landing between a delegation and the worker's first action leaves the delegation answered by nobody, in a channel that reads exactly like a long turn.

### **7.4 Loop Control**

Agent-to-agent mentions make unbounded chains possible: each turn is individually well-behaved and under budget while the chain runs until someone notices.

Two counters bound them, both carried in the turn record and never shown to the model. **Depth** measures how far work has been handed _down_ from a human; **chain length** measures how many turns one human post has produced at all.

**Depth counter:**

- Human-initiated turn → depth 0
- Trigger-initiated turn → depth 1 (a cron is not a human; unattended work is the dangerous kind)
- Agent-initiated turn → parent depth \+ 1, **unless the mention is a return**, in which case the depth of the turn being returned to
- Limit 10 (`turns.delegationDepthLimit`). At the limit, agent mentions in output are refused and the turn posts visibly: _"I would have asked a colleague but I've reached the delegation limit — someone needs to pick this up."_

**A return is an answer to the turn that asked.** A mention is a return when the post carrying it was authored by a turn whose own triggering post was authored by a turn of the agent now being activated: Sam asks Naomi (Naomi at depth 1); Naomi mentions Sam (a return: Sam back at depth 0, the depth of the turn that asked). Had Naomi mentioned Omar instead, that is a hand-off, and Omar is at depth 2. Depth therefore counts nesting, not exchanges — a supervisor that delegates one unit at a time and verifies each result sits at depth 0 for the whole run, its worker at depth 1, however many units there are. The test is mechanical and read off the store: the activating post's authoring turn, that turn's triggering post, that post's authoring turn, and whether the last is the activated agent's own. No configuration declares a supervisor; the shape is recognized from the posts, so it can never be claimed by an agent or drift from what the channel shows. The same discipline governs who may close a unit of delegated work (§3.15): the relation is a field on the unit, so it is read rather than declared, and the framework never asks an agent what its role is.

_Why depth alone was the wrong bound for this shape:_ under the previous accounting every mention was a hand-off, so a supervisor and its worker exchanging one unit of work cost two levels, and a run of six units was refused as if it were a six-deep chain of strangers. The shape the limit exists to catch — work passed further and further from the human who asked for it — is exactly the shape a return is not.

**Chain length:**

- Human-initiated turn → 1, and the turn is the root of its chain
- Trigger-initiated turn → 1, and the turn is the root of its chain
- Agent-initiated turn, return or hand-off → parent chain length \+ 1, carrying the parent's root
- Limit 200 (`turns.chainLengthLimit`), counted as the turns carrying one root and enforced when a turn is opened, so the count can never exceed the limit. At the limit an agent's mention in output is refused first, as the friendly stop — and a hand-off through a work unit (§3.15) is refused before it runs — the turn posting visibly: _"I would have continued with a colleague but this chain has reached its limit — someone needs to say whether to go on."_ A turn that would still exceed it is not opened, and the system bot says so in the channel, naming the agent that was not activated; a fresh human post starts a fresh chain.

**Chain length is what returns make necessary.** With returns free of depth, two agents could answer each other indefinitely at depths 0 and 1, and the only brake would be the hourly ceiling — an emergency stop, not a design. The chain-length limit is the bound on total unattended work one human post may set in motion: a fresh human post starts a fresh chain, so continuing past the limit costs exactly one human-visible act, which is the property every other limit in this section has. The number is deliberately far below the hourly ceiling, so that a legitimate long run is refused by its own limit and reported by the agent, rather than halting every agent in the framework.

**Depth bounds the chain only because §4.5 bounds its width.** Every turn may address at most one peer, so a chain stays a chain: ten levels is ten turns, not ten levels of a branching tree.

**Chain length is counted by root, not along a path.** Every turn records the human or trigger post its chain descends from, and the limit is the number of turns carrying that root. Under §4.5 a path and a chain are the same thing, so the two accountings agree; counting by root keeps the number true without depending on that, which matters because this is the bound on total unattended work one human post may set in motion, and because a turn may now reach the channel with more than one post (§3.15, §4.5). The count is enforced when a turn is opened, in one transaction with the row's insert, because a chain may have two turns running at once (§3.15) and two checks made at output time can both pass at the limit; the refusal at output remains as the early, agent-voiced stop, and admission is the guarantee. A turn with no recorded root is its own root: a restart does not continue a chain (§7.3).

Enforcement is in the framework, not the prompt. Prompt-level constraints are advisory, and advisory constraints are what produced Hermes.

**Global ceiling: 500 turns per hour, framework-wide** (`turns.hourlyCeiling`). Breach halts all agents, posts prominently, and requires an explicit `/collegium resume`. A halt invalidates pending approval prompts, as a restart does. While a halt stands, queues do not drain and triggers are not flushed — a trigger posted into a halted channel would strand, the exact outcome idle-gating exists to prevent. On clearing, `/collegium resume` runs the same drain-and-flush sweep boot performs.

**`/collegium resume` refuses only what it can objectively re-check.** A §3.10 topology violation is a fact about membership, so a halt raised by one stands until membership is fixed. A ceiling halt clears on the human's authority: the rolling window is reset and a fresh allowance begins. The halt exists to stop a chain and put a human in front of it; once they have looked, their judgement is the control the system was routing to, and a check that overrides it while offering no way to say _"I have seen it and it is fine"_ turns an emergency brake into a timer — which is not something a human can be accountable for.

_Accepted cost:_ a loop that trips the ceiling is handed a fresh allowance every time someone resumes it. The compensating controls are that the halt post is prominent, the resume is attributable, and the running count is in front of whoever clicks.

**The rolling window is durable; the halt flag is not.** Turn starts are counted from the store, from a persisted watermark that `/collegium resume` advances, bounded to the trailing hour. A `/collegium clear` (§8.5) keeps every Turn row, so a clear is not a way to reset the count. The halt not surviving a restart is acceptable only because a restart breaks the loop that raised it; a crash-looping instance granting itself a fresh allowance every boot, with nobody deciding anything, would instead make the framework-wide number untrue. The ceiling is therefore re-evaluated at the first turn start after boot, and re-raises the halt if the window is still full.

### **7.5 Manual Intervention**

All three commands are **channel-scoped and apply to all agents in that channel.**

`/collegium stop` aborts current turns at the next iteration boundary. The honest guarantee is _no further tool calls_, not _nothing happened_.

`/collegium kill` abandons current turns immediately: the turn record is closed and the channel lock released. A tool already in flight may still complete and its side effect may still land — `/collegium kill` is for a wedged process, and it accepts that ambiguity in exchange for immediacy.

`/collegium steer {text}` hands one instruction to the turns running in the channel, read before each turn's next completion. It is what §4.4 folding cannot be: folding discards the completion that only saw half a request and reassembles from scratch, which is affordable only before the turn has acted, and a turn that has already written a file cannot be rewound. Steering therefore keeps the work already done and appends — the instruction arrives as the human speaking, prefixed with their name exactly as a post would be — but it does discard the one thing that has had no effect yet: a completion in flight when the steer arrived is thrown away, unrecorded and unexecuted, and made again with the correction in context, for the reason §4.4 gives. A plan made before the correction is exactly what the human is correcting, and acting on it, or posting it as the final answer, would be the steer arriving one step too late. A steer **spends one action attempt**, so a human who keeps steering runs into the same ceiling a denial with a reason does (§5.3); the discarded completion is the same cost a fold pays. The turn names the steer and its author on its status post, and the trace keeps the text, so this is not a whisper: a later turn's window replays it as the post it resembles. A tool already running when the steer arrives is not interrupted, which is the same honest guarantee `/collegium stop` gives, and a turn parked on an approval is steered by denying with a reason (§5.4), not by this command. With nothing running, the invoker is told so and the text is discarded rather than queued; a steer with nothing to steer is a typo, and §5.2 remains the one durable path for work.

_Why a command rather than a post:_ §5.2 says an addressed post is always queued and acknowledged, however busy the agent is, and that rule is load-bearing — absorbing an addressed post would silently drop work, since nothing about absorption is durable. A command is not a post: its response is ephemeral, it re-activates nobody, and it creates no obligation the framework then has to honour. The cost is that a human who posts expecting to steer gets a queued turn instead, which is the correct outcome and an unfamiliar one.

`/collegium stop` and `/collegium kill` post visibly; a steer is ephemeral to the invoker and visible through the status post. Any human in the channel may issue any of the three, since stopping is always safe and steering is no less safe than posting. Neither clears the queue: whatever was pending drains into the next turn.

**A command's own response is ephemeral**, so it never enters a channel as a post and cannot re-activate the agent it just interrupted — a `/collegium kill` that wakes what it killed is not an intervention. The visible notice is separate: posted by the system bot where it is present, and under the agent's own account in a DM, where Mattermost admits no third party. Both are deterministic code, the second exactly as §3.2 permits for stop notices.

Either command also resolves a pending approval in the channel as **cancelled**: the prompt is rewritten to an invalidated terminal state, exactly as a restart does, and no follow-up posts. A cancellation is not a denial — denial statistics keep meaning that a human refused an action. This is how `/collegium stop` reaches a turn parked on an approval, which is never between iterations and would otherwise be untouchable for days.

### **7.6 Stalls Are Announced**

Every exit in §7.1 posts, or was caused by a human watching. Three shapes end a run with nothing said at all, and leave the channel reading exactly like work in progress or work finished: work queued behind no running turn, a turn that holds its channel and makes no progress, and a reply to a colleague that addresses nobody. The system bot names each in the channel it happened in. **It announces and never clears**: nothing here kills, retries, drains or re-routes anything, because a notice that acted would be the recovery A4 rejects, and the human reading it is the one who decides.

- **A standing queue.** An agent has held a queue entry for a channel (§5.2) with no turn of its own running there for `notifications.stalls.standingQueueMs` — ten minutes by default. A failed exit leaves its post standing until a human posts (§7.1), a peer's mention waits for one, and a chain refusal or a restart can leave either. The notice names the agent and says what clears it: a post addressing the agent starts the turn that reads what waits, and `/collegium queue {agent}` shows it.
- **A long turn.** One turn has held its channel's lock (§5.1) for `notifications.stalls.longTurnMs` — thirty minutes by default — since it started or last waited on a person. Time parked on an approval or a question is not counted, and restarts the clock: that wait is its prompt's to announce, and its remedy is an answer, not a kill. The notice names the agent and how long, and says that `/collegium kill` ends a turn whose status post shows no progress; a turn still working needs nothing.
- **A dropped hand-off.** A turn a colleague's mention started ends in a reply that mentions nobody, having published no post that mentions anyone — no report through its work unit (§3.15), no mention in its own words. The colleague that asked is never woken, and the run ends there. The notice says the reply reached no one and names the colleague whose mention started the turn. It does not re-route the reply: whether the reply was meant for that colleague is a reading, and a framework that re-addressed it would be deciding whom an agent speaks to.

The first two are found by a periodic sweep, so a notice lands within one sweep of its threshold; the third is said as the turn ends. Each is **one notice per episode**, re-armed only once its condition clears — the entry drains or is discarded, the turn ends or waits on a person — so a standing condition is said once, not every minute it stands. Nothing is announced while a global halt stands (§7.4): its own post already says why nothing moves. An agent is named without its @, as every system-bot notice names one, because a mention from the system bot would activate the agent it describes (§3.10). In a DM, where the system bot is never a member, the notice is posted under the agent's own account — deterministic code speaking as the agent, as §3.2 permits.

_Why notices and not timeouts:_ each of these was a common way a long run died, and each died silently — the channel read as busy, or as finished, for hours, until someone happened to look. A timeout that killed the long turn would also kill the legitimately long one, and a sweep that drained the standing queue would be the retry timer §7.1 refuses. What was missing was never a mechanism; it was a sentence in the channel. Neither threshold is a limit the agent can see or work around: A3 is untouched, since nothing here starts a turn.

## **8. Persistence And Observability**

### **8.1 What The Human Sees**

**One status post per turn, edited in place** as the turn progresses. Tool calls are appended to it as they occur, so the post accumulates a readable trace of the turn rather than only showing current state. Mattermost supports post updates with a websocket edit broadcast, so connected clients re-render live. Edits coalesce: a line is queued and lands on the next edit with whatever else queued by then, so the turn never waits on the chat server between one tool call and the next; only the closing edit is waited for.

**Each line names the tool and what the call is doing** — the URL navigated to, the path written, the command run — because a column of bare tool names says a turn was busy without saying what it did. Each tool renders its own one-line summary, choosing which of its arguments a supervisor needs; the line is capped in length and the untruncated arguments are always in `/collegium trace`. The line is written before the call runs, so arguments the tool's schema will reject have no summary and the call is named alone. The closing line also states how long the turn ran.

**The closing edit names what the turn may have changed.** Beneath the trace, one line lists the calls the turn completed to tools not declared `retryable` — which §7.2 reserves for reads — grouped by tool with a count: `prospects::create_prospects ×3`. It is written on every exit, a normal completion included, from the framework's own names for the tools (§3.2). A turn's reply is model text, and can be wrong about its own effects in either direction; the line is the framework's record of them, set where the reader of the reply will look. §7.1 names the same calls in a failure post, where the natural reading is that nothing happened; this line is for the reading that everything the reply claims, and only that, did.

_Why not stream every tool call as a separate post:_ a ten-call turn would produce ten posts of machinery around one post of substance, and approval prompts live in the same channel — noise in the supervision channel degrades the gate (A5).

A memory write, its evictions, and a memory delete appear here as ordinary tool-call lines; what was written, evicted, or removed is in `/collegium trace` (§3.6).

Queued messages are acknowledged with a 👀 reaction (§5.2). This and the typing indicator below are the only signals the framework emits without posting.

**A typing indicator shows while the model is generating**, using the substrate's own ephemeral typing signal. It creates no post and nothing durable. It is deliberately dark during tool execution and while an approval is pending: the status post and the approval prompt already account for that time, and an indicator held through a human's deliberation would claim work that is not happening.

**It also shows through the §4.4 window**, which is otherwise the one stretch where an agent has committed to answering and nothing says so. The signal expires on its own, so covering the window takes no bookkeeping — it does mean the window must stay well inside the substrate's expiry.

_Why this and not an eagerly-created status post:_ a turn that calls no tool should leave nothing behind but its reply (A5), yet the human who addressed the agent is owed some sign that it heard them. An indicator that expires on its own satisfies both.

### **8.2 What SQLite Holds**

**SQLite is authoritative for conversation content.** Context assembly reads only the database, never the Mattermost API on the turn path.

_Why a second copy at all:_ an agent's context is posts **interleaved with** tool calls, tool results, approval requests and decisions, and model metadata — its own turns' trace, never a peer's: tool results carry per-agent authority (§3.4), and raw traces are need-to-know even among humans (§8.3). None of that exists in Mattermost except as rendered text. Split across two stores, every context assembly becomes a merge-join across different clocks and ID spaces on every turn. One ordered store is a material simplification.

Stored: every observed post and the files it carried by name, type and size, every tool call and result, every approval request and decision, the trigger table, the queue state, the work units (§3.15), and per-turn metadata (depth, chain length, action count, model, token usage). The file bytes are not stored: Mattermost holds them. Tool identities are stored structurally (§3.4) — two columns where a scalar once held the name, the segment array inside JSON payloads — with a bare string reserved for what resolves to no tool: unresolvable model output, or a framework action like the budget extension.

Run in WAL mode with a busy timeout, since per-channel concurrency means concurrent writers.

**Backfill on boot is required.** Posts made while the process was down are absent from the store. Each channel is backfilled from its last recorded post ID forward, **per agent, using per-agent tokens** — never a privileged token, or the framework would import posts from channels the agent has no membership in and write them into a store the agent reads from. Backfilled posts never trigger a turn but are context-eligible, as history rather than missed requests.

**Repair path:** slash commands typed in the channel rather than a SQL console, so repair stays visible and attributable.

_Known wrinkle:_ post edits propagate during downtime via backfill but not during uptime, since there is no conflict resolution. Same event, different outcome depending on timing.

_Accepted losses:_ editing a post in the client does not correct what an agent believes; deleting a post in the client does not redact it from context — `/collegium clear` (§8.5) is the one deletion the framework performs and honours; a late-joining agent has no channel history before its join point, and search (§3.8) cannot find what was never stored.

### **8.3 Trace**

The complete tool trace — every call, arguments, and results — is retrievable via `/collegium trace {post-id}`, where the post is named by its id or by its permalink, since `Copy Link` is the only place the client exposes one. **The response is ephemeral, visible only to the invoker**, because trace output contains file contents and email bodies verbatim, and everyone in a channel can also approve agents.

A trace carrying those payloads runs into the same substrate limit §6.2 does, and takes the same answer: where it exceeds what a single post can carry, it is delivered as an attachment, still ephemeral. One rule for content larger than a post, in both places it arises.

Reading traces is how the tool inventory gets tightened over time.

### **8.4 Command Surface**

Every command is a subcommand of one slash command, `/collegium`, so typing `/collegium ` offers the whole surface with an argument hint and a line of help per subcommand:

- **`/collegium trace {post-id}`** — full tool trace for a turn. Ephemeral.
- **`/collegium forget {post-id}`** — remove a post from agent context. Posts.
- **`/collegium reset {agent}`** — mark an episode boundary. Posts.
- **`/collegium stop`** — abort current turns in this channel at the next boundary. Posts.
- **`/collegium kill`** — abandon current turns in this channel immediately. Posts.
- **`/collegium steer {text}`** — hand one instruction to the turns running in this channel, read before each turn's next model call; a call in flight is made again. Ephemeral; the turn names it on its status post.
- **`/collegium resume`** — clear a global halt.
- **`/collegium approvals [{agent}]`** — every approval still waiting on a human, in the channels you are in, oldest first, each naming the agent, the action, its age, and a link to its prompt. Ephemeral. §3.7 gives an approval no timeout and §5.2 lets work accumulate behind it without bound, so a parked prompt is the thing most worth finding without scrolling for it, and the oldest one is the one blocking the deepest queue. The channel filter is the same live-membership check that decides who may answer one (§3.7): the listing shows what a member could already see, and says so plainly when there is nothing to show rather than hinting at what is elsewhere. It decides nothing — the buttons on the prompt post remain the only way to answer.
- **`/collegium queue {agent}`** — show pending depth and the oldest unprocessed post. Ephemeral.
- **`/collegium queue {agent} clear`** — discard the standing queue entry, so the next drain does not run work a configuration change made stale. Posts. The posts themselves stay; only the pointer goes, which is why this is not a deletion of anything §5.2 holds.
- **`/collegium triggers {agent}`** — list outstanding triggers. Ephemeral.
- **`/collegium memory {agent}`** — inspect and prune an agent's memories. Ephemeral.
- **`/collegium units {agent}`** — list an agent's open work units in this channel, with age and state (§3.15). Ephemeral.
- **`/collegium units {agent} cancel {reference}`** — close a unit as cancelled on a human's authority, for one whose creator will never reach it. Posts.
- **`/collegium inspect {agent}`** — show an agent's model, tools (marking which need a human on every call), skills, schedules and system prompt. Ephemeral. Each schedule is shown with its next occurrence in the operator timezone.
- **`/collegium usage`** — show token usage per agent and model, with cached-prompt and reasoning breakdowns and the cost the provider charged where it reports them, over turns that ended in the last 24 hours in any channel. Ephemeral.

A bare `/collegium`, or a subcommand nothing declares, answers the invoker with the list above.

**The command is held by a Mattermost plugin the framework ships, and the framework declares its subcommands to that plugin at boot.** Mattermost offers nested autocomplete only to commands a plugin registers; a command created over the REST API carries one hint and one line of description, and a surface of eleven would be eleven dotted triggers. The plugin knows nothing of the subcommands: it holds `/collegium` for a team, forwards every execution on that team to the callback the framework declared, and relays the answer. It also forwards the execution's trigger id, so a subcommand may open a dialog, and holds one further route — delete every post in a channel before a given post — that answers only the account that declared the team's surface (§8.5). The framework's command definitions are the one source, and the plugin is the substrate's view of them.

**Provisioning installs the plugin; boot declares the surface.** Installing is system-level — an upload, and a server may forbid uploads — so it belongs with the other administrative writes, at the version this release ships and left alone when that version is already present. Declaring is the framework's own: the callback is the app's public URL, which only the app knows, and an administrator transcribing it once would drift silently on the first redeploy that moves the host or port. The declaration is scoped to the team and takes the same grant as creating a slash command there, `manage_own_slash_commands`, which the system bot holds as a team administrator; the plugin persists it per team and re-registers on its own activation, so a Mattermost restart does not lose the command while the app is down. Two deployments on two teams of one server each declare their own `/collegium`.

Boot fails loudly if the plugin is not installed or the declaration is refused. A framework that starts without its stop switch is worse than one that does not start.

_Why this is not left to provisioning entirely, unlike §3.1:_ the failure is invisible in exactly the wrong direction — §7.5's intervention commands are unreachable at the moment someone reaches for them, and Mattermost surfaces it as an opaque client error rather than as an absence. This is the framework declaring its own entry points, not deciding topology; §3.9's rule that channel topology is declared rather than chosen is untouched.

_Accepted cost:_ the plugin is a second artifact, in Go, with its own build. It stays generic so that the command surface never has to be edited in two places, and a release before it registered one dotted command per subcommand under the system bot; boot removes those relics.

### **8.5 Clearing A Channel**

`/collegium clear` gives a channel a fresh start: every post in it is deleted from Mattermost, and every agent's record of it is deleted from the store. It is what `clear` is in a terminal, with one difference the substrate forces — a terminal forgets nothing, and this forgets everything, because the agents read the store and a human who sees an empty channel is entitled to assume the agents see one too. It applies to every agent in the channel, in a channel or a DM alike, and any member may run it, since membership is the whole authority model (§3.7). It is the one deletion the framework performs and honours; §8.2's accepted loss — that deleting a post in the client does not redact it — stands for every other deletion.

**Content goes, accounting stays.** Deleted: the posts, the trace events of every turn here, their approvals and asks, the episode boundaries, the queue entries, the work units (§3.15), and the rows of triggers that already posted here — a trigger's reference carries a subject or a body, so it is content. Kept: the Turn rows, with what they cost and how long they ran, and with every pointer to a post set to null, so the §7.4 hourly count and `/collegium usage` read exactly as before and no row names a post that exists nowhere. Kept too: the files agents wrote, plugin storage, mail, schedules, the global halt, and triggers still pending, which post into the cleared channel when the idle gate opens, since they are future work rather than history. Search from any channel no longer finds what was here, because it is gone rather than hidden.

**Memories are kept by default.** Memory is the agents' work product, not the channel's record, and the path by which knowledge deliberately crosses channels (§3.6); the human saw each write when it was kept. A clear that silently destroyed them would undo disclosures already accepted. `--memories` deletes those written from turns in this channel — selected by provenance, the originating post of the writing turn, which is exact for an entry written and revised here and approximate at the edges: an entry born here and revised elsewhere survives, one born elsewhere and revised here goes, because a revision carries the revising turn's provenance. `/collegium memory {agent}` remains the way to prune one on purpose, and the way to see what a clear left.

**A confirmation dialog stands before it**, the substrate's own mechanism for a slash command that must not fire on a slip. It states what goes and what stays, in two sentences. Every other command runs on a keystroke because every other command is safe or reversible; this one is neither.

**It refuses while any turn runs here**, including one parked on a decision. It does not stop or kill: §7.5 gives those two different guarantees, and the human chooses between them. On confirmation it takes every agent's channel lock (§5.1), so no turn can start until the store is cut, and refuses if any lock is held, since a turn may have started while the dialog stood.

**The notice is the boundary.** It is posted first, by the system bot where present and under the agent's own account in a DM (§7.5), and if it cannot be posted nothing is changed. Everything older than it goes, on the two clocks an episode boundary already uses (§3.8): posts on Mattermost's, events on this host's. A post that lands during the clear is newer than the notice and survives in both stores; a queue entry it created is pointed at the notice, so the drain reads what arrived rather than what was removed. The store is cut in one transaction, which also records the notice, so a restart backfills from the notice forward (§8.2). Then the plugin deletes every post before the notice, in the server's own process — the system bot is never a member of a DM and holds no right to delete there, and one call is what a thousand posts should cost. The plugin serves exactly one caller for this: the account that declared the team's command surface, which is the system bot by construction, and only for a channel on that team or a DM. Nothing is granted to any role.

**Failure is stated, never repaired.** The store is cut before the posts are deleted, so a failure between them leaves a channel the agents have already forgotten and the human can still see — the honest direction, and the notice says so and how many remain. A failure inside the transaction leaves everything as it was, and the notice says that. A crash mid-way leaves the notice standing at whatever it last said. In every case `/collegium clear` again is the repair: it finds nothing older than its own new notice in the store and removes what remains in the channel.

_Why deletion and not a boundary for everyone:_ a `/collegium reset` for every agent would hide the same content and delete nothing, and the store would hold what the channel no longer shows. §8.2's justification for the second copy is context assembly; content nothing will ever assemble is dead weight the human believes is gone. "Cleared" has to be true of the database, or the command lies.

## **9. Deliberate Non-Goals**

**No self-modification of instructions.** Agents cannot write skills, system prompts, tool definitions, schedules, channel configuration, or model selection. Memory is the sole exception. A schedule is in that list for the same reason a tool definition is: it is the agent's own activation surface, and A2's guarantee that an agent's capabilities are enumerable by reading config extends to _when_ it acts, not only to what it may do. An approval would not repair this — every other approval in the system authorises one call, where a schedule authorises an unbounded number of future turns, and the row would answer "when does this agent wake" from SQLite instead of from configuration.

**Fixed model per agent, no fallback chain.** A provider outage means the affected agents are dead for the duration, failing loudly.

**No queue bounds and no expiry.** Backlog grows without limit and nothing goes stale. Accepted for a system with a small number of internal users; revisit if a channel is ever genuinely swamped.

**No plugin ecosystem, and no plugin sandbox.** No registry and no discovery: what loads is named in `config.json` and mounted by the operator, and nothing is fetched. `@collegium/sdk` is published so a plugin can be written in a repository of its own, released with the framework and carrying its version, so the range a plugin declares names the deployment it was written for. A mounted plugin is compiled against the SDK the image carries — the version it declares governs its author's own tooling and nothing else, and boot refuses a plugin whose declared range that version does not satisfy. No isolation between framework and plugin: trust is total and deliberate (§3.14). Plugins do not depend on, extend, or communicate with one another; there is no lifecycle beyond startup — no hot reload, no enable/disable at runtime. Nothing in the system lets an agent write, install, configure, or enable a plugin — the prohibition on self-modification extends here unchanged.
