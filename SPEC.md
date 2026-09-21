# **Multi-Agent Orchestration Framework**

## **0. This Document**

This specification is normative for behaviour: what an agent, a person or a test can observe the system do, and what must always hold. Where the code disagrees, the code is presumed wrong, but the disagreement is a finding for a person to resolve, never something to align silently in either direction.

A sentence belongs here if it states a guarantee — something whose violation a person could observe — or the reason for one that no axiom already supplies. How the code achieves a guarantee, which module holds it, a configuration key or its default, and the alternatives that were rejected do not belong; the code, its comments and the configuration reference hold those. A new guarantee is written here as well as in the code that provides it; a new mechanism is not.

Every section is amendable, the axioms included. The weight of the case scales with what rests on the section: a proposal quotes the sentences it changes, names what elsewhere it invalidates, and says why the reason recorded for the current rule no longer holds. Nothing here changes until a person has approved the proposal.

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

The prompt is written in configuration, either inline or as a markdown file the configuration names beneath the resources root, because prose escaped into a JSON string is prose nobody reviews. Which form is used changes nothing downstream.

Each agent is a **Mattermost bot account** with its own access token, addressable as `@{username}`, shown with a `BOT` tag in the member list.

Agents are persistent colleagues, not task-scoped job runners. There is one instance of each agent, continuously; conversations are episodes in an ongoing relationship rather than independent invocations.

Provisioning is a deployment act, not a runtime one: before the app starts, a separate process reconciles Mattermost against the configuration — the team, the channels, one bot account per declared agent, and the token each is addressed with. It converges; boot only refuses. Channel membership is not converged: every bot joins the main channel, an agent joins the channel its mail is announced to, and the system bot joins every channel the configuration names, so its notices (§3.2) have somewhere to land. Who else belongs in a channel is set in Mattermost by the people who run it, and §3.10 is checked against that membership rather than against a second declaration that would have to agree with it. Against a Mattermost it did not start, provisioning refuses before creating anything if the server's settings forbid bot accounts, personal access tokens, or the callback address, naming each one. Nothing the running framework does creates an account or a channel, and **there is no runtime agent spawning**: every worker has a durable identity and its output is in a channel.

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

**Posting is performed by the framework, not by a tool.** Text emitted alongside a tool call updates the status post and is transient. Text emitted with no tool call is the turn's final output and terminates the turn. Posting does not consume the action budget. A framework tool may return a post beside its result, which the framework publishes under the agent's account from the tool's own template — the arrangement §3.7 uses for an approval prompt and §3.15 for a work unit's state change. A plugin tool cannot return one.

### **3.4 Tool**

A hand-written TypeScript function exposed to the model with a schema. **One tool per action** — there are no tools whose behaviour branches on an `action` argument; a tool that would is two tools.

**A tool's identity is two segments, `[namespace, tool]`,** rendered per audience: operators, approvers, config, traces, and errors see `mail::send`; the model sees `mail__send`. A call arriving in the display form is resolved all the same, since the framework's own approval posts put `mail::send` in the agent's window (§8.1). A call naming the tool segment alone — `send` — is resolved when exactly one granted tool carries it, because a model drops a namespace far more often than it invents a tool. No spelling resolves to a tool the agent was not granted; a name claiming anything else is answered as §7.2 says.

**A toolset is a namespace and everything that belongs to it**: its tools, the services they may reach, the settings they are configured by, the storage collections they own, the skills they ship.

Each tool declares, alongside its description and parameters:

- **`approval`** — present means the tool **always** gates (§3.7): the function renders the payload the approver reads and cannot decline. What it renders is the model's own arguments, the operator's own configuration, and the records in the toolset's own storage that the call acts on — never text a call the tool itself makes returns, which is unverified once anything external supplied it. An approver asked to delete a record reads the record as it is stored, not the model's description of it. Whether a granted tool can act without a human is therefore answerable from config alone, and `/collegium inspect` marks it per tool; a tool whose gate would depend on its arguments splits into two tools. A plugin tool must **state** the choice, `null` for "this does not gate" (§3.14), because an omitted field cannot be told from a forgotten one.
- **`retryable`** — whether a timed-out call may be reported to the model as a plain failure (§7.2); false, the default, ends the turn as an unconfirmable side effect.
- **`budgetExempt`** — never billed against the action budget (§5.3). Framework toolsets only; a plugin cannot declare it.
- **`concurrent`** — may run alongside the other concurrent calls of the same completion (§5.1): a read that neither depends on nor disturbs what another call in the batch touches. A browser action is not one.
- **`supersedable`** — a later result of any supersedable tool in the same turn makes this one stale (§3.8): a page the model acts on once and moves past.

A tool reaches only what its toolset declared. A tool that creates a durable record returns its disclosure — body, description, reference, anything superseded — and the turn writes it into the trace (§3.6).

Reads are generally ungated: search, fetch, read mail. Writes, shell commands, and anything externally visible carry `approval`.

**Authority parameters are never model-supplied.** Any argument determining _whose authority an action carries_ is fixed in tool settings — the `from` address on outbound mail, credentials for external services. The model may request that mail be sent; it cannot choose who it appears to be from, and boot refuses a mail-granted agent without a mailbox (§3.13).

**Filesystem scope.** The `workspace` tools and `shell::run` are confined to the agent's own directories — the former by path confinement, the latter by OS permissions (§A2). They are not the _same_ directory, and both paths are stated in the preamble (§3.8) rather than left for the agent to discover by failing. Purpose-built tools may write to real systems by their own internal logic; those are individually reviewed and their write targets are fixed in code, never chosen by the model.

**Reading the workspace is not a shell command.** The `workspace` toolset's reads — `workspace::list`, `workspace::read`, `workspace::find`, `workspace::grep`, `workspace::stat` — take typed arguments under the same path confinement as `workspace::write`, so there is no command string in which a second command could hide. Each is ungated, because the confinement that bounds a write bounds a read of the same directory. The shell's own directory is not reached by these tools; a read there is still a `shell::run` under the gate.

**Shell output a result cannot carry is kept where the agent can read it.** A command's result carries a bounded prefix of each stream. Where the output ran past it and the agent holds `workspace::read`, the whole capture is written to a file in the agent's workspace and named in the result, so the rest is a ranged read rather than a second command under a second approval. The capture is itself bounded, says how much it dropped, and only the most recent few are kept. An agent without `workspace::read` gets the prefix alone.

**Browsing.** The `web` toolset drives a real rendered browser in a turn-scoped session: `web::navigate`, `web::click`, `web::fill`, and `web::hover` act against element refs from the latest snapshot, each action returning the page as markdown. A ref the page hides — a submenu that opens on hover — is marked `hidden`, and an action attempted on it is a typed refusal naming `web::hover`. A tab the page opens for itself is closed and reported with its address, so the session never moves onto a page nothing asked for. **It may submit forms and sign in where the task calls for it** — a great deal of the open web is unreachable otherwise.

It is ungated all the same. The per-agent grant decides who may browse at all, the status post traces every action live, and a per-action approval would stall autonomous turns while approving only an entry URL — never the later actions that could transmit. This is the widest ungated surface in the system and is named as such rather than hidden: an agent that browses can transmit on its own authority.

What a fill types is shown like any other argument — in the status post, in the trace, and in the snapshot that follows — so nothing in this toolset is built to carry a secret. The one compensating control is scope, which **is enforced, not requested**: only `http(s)` URLs are opened, and only on the public internet — a `file://` URL, or a host naming this machine or its own network, is a typed refusal. The check runs on every request the session makes, not only the address the model asked for — a redirect, a same-session link click, or a page's own sub-resource fetch is judged the same way, with the name resolved and every answer judged, so a public URL that leads somewhere private does not reach it. A deployment may declare its own network browsable, so that pages it serves itself are reachable by its agents; the declaration lifts the private-address refusal for every agent and every request, leaves the scheme rule standing, and is logged at boot, so a deployment that has opened its network has said so in its configuration and in its log.

Sessions are fresh anonymous contexts disposed at turn end — no cookies persist and no login outlives the turn that made it. robots.txt is not consulted: these are agent-driven reads at human pace, not crawling. Non-HTML resources (PDFs) are a typed refusal.

Beside the browser sits `web::fetch`: one plain HTTP GET, no session and no script, converted to markdown by the same rules and bound by the same URL policy on every redirect hop, with the connection pinned to the address that passed. It is the cheap first read for static pages; a page that yields nothing without JavaScript is a typed refusal naming `web::navigate`, and a textual non-HTML body is returned as it is.

`web::search` queries a search provider and returns ranked summaries — title, URL, snippet — never the pages themselves. The provider and its key are fixed in the agent's `web` settings, never model-supplied, and an agent whose settings name no provider is not offered the tool. Throttling is a result the model reads; refused credentials or an unanswering provider end the turn.

**Grants and settings are one config mechanism.** An agent is granted namespaces or single `ns::tool` refs; a namespace grant covers tools added to that namespace later, so a plugin update can widen an existing grant with no config change — accepted, since installing a plugin is already a trust decision. Effective settings per toolset are the deployment defaults merged shallowly with the agent's own, then parsed against that toolset's own schema. Settings for an ungranted toolset are an error, and a granted toolset whose merged settings fail its schema is an error — "mail requires a mailbox" is what the mail settings schema says, not a rule anyone maintains. A tool may declare that it works only under certain settings: a namespace grant leaves it out until the agent's settings enable it, and naming it by ref without them is a boot refusal.

**Core tools are framework machinery, not grantable capability.** `builtins::now`, `skills::load`, and `triggers::resolve` are in every agent's tool set — reading the clock, loading an assigned skill or one of its references, clearing a trigger the framework itself raised — and naming one in config is an error. A plugin cannot contribute one.

### **3.5 Skill**

A procedure stored in the repository as a directory holding a `SKILL.md` with a description, an optional list of the tools it calls, and supporting reference documents beside it. Skills are validated at boot, and a malformed or undeclared one refuses the boot.

Each agent's system prompt carries a **skill manifest**: the names of its assigned skills plus one line of description each. The full body is pulled into context on demand via `skills::load`, and one of that skill's references by the same call naming it. The body returned carries the skill's reference index, so an agent that has loaded a skill can never be unaware which references it has.

**A skill shipped by a toolset is namespaced like a tool** — `bookmark::saving-bookmarks` — and granted the same way; any toolset may ship skills, framework or plugin. Framework skills belonging to no capability keep bare names, which cannot collide, because every other skill carries a namespace. Granting a namespace's tools does not grant its skills, or the reverse. Core skills — `handing-work-to-a-peer` and `understanding-collegium` — are in every agent's manifest, are not grantable, and naming one in config is an error.

**A skill may name the tools its procedure calls.** Where it does, boot refuses an agent granted that skill without them: a procedure whose third step is a tool the agent does not hold is a turn that goes wrong in the middle, where the pairing was knowable before the process started. The list is the author's claim about the procedure, not a grant and not a filter — it reaches neither the model nor the tool registry.

**Agents cannot write skills.** Skill authorship is an administrative act. The manifest is what makes on-demand loading safe: an agent may fail to judge _when_ a procedure applies (an ordinary error) but can never be unaware that it _exists_ (a structural blind spot).

Where a procedure is load-bearing, encode it as a single hand-written tool rather than describing it in a skill: an ordering that must hold, or a payload that must carry a particular part, such as the criteria a hand-off will be judged by (§3.15). A procedure in a prompt is a suggestion; the model will eventually skip the step that mattered. What a skill is left with is judgement.

### **3.6 Memory**

A per-agent store, reachable by agents only through tools. Each entry has a **description** (the trigger) and a **body** (the content).

- **Descriptions are loaded into the system prompt on every turn.** Bodies are loaded on demand.
- **Writes, revisions and deletes are ungated** — the single exception to A5.
- Entry count, description size, and body size are all capped by the memory toolset's settings (§3.4). An over-length description or body is refused, never truncated; a write at the entry cap evicts the entry whose body was read longest ago, since the store already knows which entries an agent keeps needing.
- Every entry carries provenance: written-at timestamp and originating post ID. Entries are shown to the agent, in the trace, and to `/collegium memory` by a short **reference**, which the store resolves back, refusing rather than guessing if it ever matched two.
- **A body is read back with its age** above the text, so a model reasons about staleness from an age rather than a timestamp. The age is in the tool result, not in the listing, so the prompt does not change as entries grow older.
- An entry is never edited in place. A revision — `memory::append` adds to a body, `memory::replace` substitutes one passage of it — writes a new entry under a new reference and deletes the old one in the same step, so a correction reads as a correction in the listing an operator saw yesterday. The description carries over; the provenance is the revising turn's.
- **A revision is one step, not a delete and a write.** Two steps leave the only copy of the body in the model's context between them, and two turns revising one entry from two channels would each rewrite a body the other has not seen. The model sends only the change; a passage `memory::replace` does not find exactly once is refused as a result (§7.2). Concurrent turns of one agent cannot lose each other's writes, evictions or revisions.
- Memory is per-agent and never shared between agents.

_Why ungated:_ gating a memory write would block an entire turn on a triviality. Memory formation cannot sit behind human latency or it will not happen. Deletion inherits the exemption: an agent that cannot retract a fact it now knows to be wrong carries that fact into every later turn.

_Compensating control:_ a write or a revision returns a disclosure — description, body, reference, anything superseded — which the trace records, and the status post carries the call like any other tool call (§8.1). This is **detection, not prevention** — the write has already happened.

Memory is one of two paths by which information crosses channels — the other is search (§3.8). Both are intentional, both leave a trace, and the channel window itself is strictly channel-scoped.

### **3.7 Approval**

A blocking request for human consent, rendered as a post **under the agent's own account** with interactive buttons — the payload is model-proposed content, which §3.2 forbids the system bot to carry.

- **Approve** — the tool executes; the turn continues.
- **Deny** — the turn terminates; the agent posts asking how to proceed.
- **Deny with reason** — opens a dialog; the reason is fed back as the tool result and the turn continues under the same budget.

The prompt must show the full payload, not just the intent. Where a payload exceeds what a single post can carry, the prompt shows a bounded prefix inline and the complete payload as an attachment (§6.2). Once resolved, the prompt post is rewritten into a terminal state and its buttons removed.

**The prompt also carries what the framework knows and the payload cannot say.** Above the payload sit facts an approver would otherwise reconstruct by scrolling: which action of the turn's budget this is, and who asked for the work — by name, with a bounded excerpt of their own words, and only where a human asked; a trigger-initiated turn says so instead. Every word of that line is framework-authored from the turn record; nothing a tool returned and nothing a page, file or message contained ever reaches it. Nothing here is a gate.

**There is no timeout.** The agent waits, for days if necessary, until a human answers. Work queued behind it accumulates without bound (§5.2). Since nothing expires and nothing chases, `/collegium approvals` (§8.4) is how a human finds what is still waiting.

**Who may approve: any human present in the channel.** There is no separate approver list, because a config-based roster would be a second access-control system that silently drifts from channel membership. A decision from outside the channel is refused.

**There is no standing approval, and no session or per-run grant.** A gated tool gates on every call; nothing a human clicks makes the next call cheaper. A standing grant can only bind a call's _effect_ — a tool and a target — never its _content_, which is different every time; and every tool that gates today gates because of its content, so a grant bound to `mail::send → alice@example.com` would authorise every future body sent to Alice, which is precisely the failure §1.1 records as nobody reading the payload.

### **3.7a Ask**

A tool may declare `ask` instead of `approval`: a blocking request for a fact only a human has, rendered under the agent's own account like an approval, with the same no-timeout and channel-presence rules as §3.7, but resolved by a text answer rather than approve or deny. The answer is fed back as the tool's result and the turn continues under the same budget — there is no denial, because there is no action to refuse. A tool that would gate on consent uses `approval`; a tool that would solicit information uses `ask`; no tool declares both.

`ask::human` is the one framework tool that uses it: a question, and optionally a few short answers offered as buttons alongside free text. It is not a substitute for approval — a tool that needs permission still gates, and the framework preamble tells the model so.

### **3.8 Context Window**

Each turn assembles context fresh from the store:

1. System prompt
2. Skill manifest (§3.5)
3. Memory descriptions (§3.6)
4. Peer roster (§3.11)
5. Tool definitions
6. **Channel window** — recent posts from the current channel, interleaved with the trace of this agent's own turns there (§8.2), walked backwards until a token budget is exhausted. The trace is never a peer's: an agent reads its colleagues through their posts alone — never their status posts, which are their trace rendered.
7. **Earlier actions** — a fixed number of lines naming what this agent itself did in this channel before the window reaches, newest first, in the replay form defined below. Its own turns only, never back past the channel's episode boundary. Mechanical and derived: nothing is stored, nothing is summarised, and no model decides what was worth keeping.
8. **Open work** — the units this agent created or was assigned in this channel and has not closed (§3.15), oldest first, one line each. Read on demand for the rest, as a memory's body is.

**A post's attached files are named in the window**, one line each — name, type and size — whether or not anything can read them. A file an agent cannot read is a fact it states, not a fact it is spared: an agent that answers the caption as though it were the whole message is wrong in a way nobody can see.

**The system prompt contains the agent's own prompt, the shared behavioral baseline, its optional personality, and the framework preamble.**

The preamble states the one runtime fact about the filesystem an agent cannot otherwise see without failing: the directories its file tools point at. `workspace::write` and the workspace reads share one directory; `shell::run` runs in a different one, and A2 makes the two mutually unreadable on purpose. Naming them grants nothing: confinement is path rooting and OS permissions (§6.1), neither of which depends on the model not knowing where it is.

_What is deliberately not there:_ the time, and the host's operating system, git state and processes. The time is a tool call, `builtins::now`, because a prompt that changes every minute defeats the provider's cache. The rest is ambient state the agent was not granted, and a snapshot of it in the prompt is a read nobody approved. An agent that needs git state holds `shell::run` and asks for it under the gate.

The behavioral baseline is rendered for every agent on every turn: task intent, routine autonomy, scope changes, recovery from failure, proportionate verification, untrusted tool content, collaboration, progress updates, what is worth keeping in memory and what to believe when a memory disagrees with what the agent can see now, and disagreement. These are advisory instructions about how the model should work, separate from runtime facts and optional tone. A personality adds a stance to that baseline, selected per agent or by default from a fixed set the framework ships.

The preamble describes runtime behavior in Simplified Technical English, using the deployment's actual budgets and exemptions: posting, approvals, memory, peers, triggers, and the prohibition on self-modification. Every sentence states a runtime fact that holds whether or not the model complies. Additional deployment guidance belongs in a personality or an agent's own prompt.

An agent's context budget is the one it declares, else the deployment default, else a fixed share of its model's window; a model cannot be offered without a recorded window.

There is no threading. All posts are channel-level, so **context is pure recency**: no structural marker indicates where one piece of work ended and the next began. `/collegium reset {agent}` provides a manual episode boundary; context never reaches back past the most recent one. `/collegium clear` is the boundary for every agent at once, with the record removed rather than hidden (§8.5). DM context follows the same mechanism as any other channel.

**The window's oldest entry holds still.** Once a window has been built, the next one for the same agent and channel starts from the same oldest entry for as long as everything since it fits the budget; when it no longer fits, the window is trimmed from the old end and holds there again. A window whose start moved every turn would never be cached past the system prompt. A restart costs one cache miss.

**A tool result replays as what it was, not what it said.** A tool may return, beside its text, the line later turns see in place of it: a skill body replays as `[loaded skill x]`, a page as its address and size, a long shell output or mail message as its size. The turn that made the call reads the text in full; a later turn reads the line and can make the call again if it needs the text. Within a turn, supersedable results are kept in full up to a share of the model's window and never fewer than two; past that, the oldest the model has already acted on reads as its line for the rest of the turn, and the line says what a re-read costs rather than inviting one. A result byte-identical to one the turn already holds costs no context and displaces nothing. The trace keeps every result in full.

**A turn's own context is bounded too.** The budget above bounds what a turn starts with; its model's whole window bounds what it may accumulate. A turn whose results push it toward that window retires its stale pages first, but never the result it has just received and not yet read. A single result that will not fit is cut to what fits, with a visible marker saying so and how much of the whole it holds, and the trace keeps the whole of it; a silent cut is what §A4 forbids. A page cut this way can be read on from where the cut fell, so a long page is finished in parts rather than re-read from the top. A turn that still does not fit ends, saying so, and the queue drains into a fresh turn, which starts from a window the budget bounds rather than from the results that overflowed.

**Prompt caching.** Context is ordered so that what changes least comes first, and the sections that change per turn come last, so providers that cache prompt prefixes can reuse them. Caching never changes what the window contains or preserves stale context. `/collegium usage` reports cache reads where the provider supplies them.

**Search reaches what recency cannot.** `conversations::search` is a read over the post store — a case-insensitive substring over post text, optionally bounded by author and date — returning each match as post ID, channel, author, time, and text. It returns posts alone: never a trace, which is per-agent and need-to-know (§8.3), never stored reasoning (§3.12), and never a status post or a notice. An agent's own replies are posts like any other, and are found. It is ungated, as reads are, and billed against the action budget (§5.3): a search that can run forty times is the case the ceiling exists for.

Search is bounded exactly as the window is, applied per channel. It reaches only channels the agent is a member of **now**, and back no further than each channel's own most recent episode boundary. A forgotten post (§8.4) is as absent from a result as it is from the window, or `/collegium forget` would be a lie.

**It never widens an audience.** A match surfaces in the current channel only if everyone who can read the current channel could already read its source. From a public channel, search reaches public channels alone; from a private channel or DM it reaches public channels and any private channel or DM whose members include everyone present. A result names its source channel, so the model can see it is quoting from elsewhere.

_Why a structural rule rather than an instruction:_ a colleague knows not to repeat a private conversation in a public room; a model quoting a raw search result will do so by accident. What was said in private and is wanted elsewhere crosses by memory (§3.6), where the human saw the disclosure at the moment it was kept.

**Search reaches what was said; the earlier-action lines reach what this agent did.** A trace is per-agent and need-to-know (§8.3), so search cannot return one, which would leave an agent able to find a colleague's sentence from last week and unable to recall the file it wrote itself two turns ago. The lines are carried mechanically instead — no second model call, no stored interpretation of the channel to disagree with the channel. They say what the agent did, never what a result said.

### **3.9 Work Channel**

Each agent generally has a dedicated Mattermost channel containing that agent and its authorized humans.

**All channel configuration is declared in configuration. Agents have no input into topology.** Membership is not part of that declaration: it is held in Mattermost and set by the people who run it (§3.1), so what configuration states is which channels exist and how each one triggers.

### **3.10 Triggering Mode**

A per-channel flag set at provisioning:

- **mention-required** (default) — the agent acts only when explicitly `@`\-mentioned
- **respond-to-all** (opt-in) — every human post in the channel starts a turn
- DMs are respond-to-all inherently, as a property of the channel type

In respond-to-all channels, agent-authored and system-bot posts must not trigger, or an agent will reply to its own output and loop immediately. The rule is: _human-authored post, or a mention from an agent or the system bot._

**A respond-to-all channel contains at most one agent.** Every human post starts a turn for every agent present, so two agents in one such channel produce two concurrent turns on the same task — precisely the harm §4.5 exists to prevent, arrived at without a mention. This is checked against Mattermost membership at boot and on every membership event; a violation discovered at runtime trips the global halt (§7.4).

### **3.11 Peer Roster**

**The set of other agents present in the current channel**, injected into the system prompt each turn, excluding the agent itself and the system bot. This is how an agent knows which peers it can reach.

**Each peer is listed with what it can do: its expertise, and the toolsets it was granted, by namespace** — never its individual tools and never their settings. An agent that sees a colleague's name and nothing of its reach plans against capability it cannot see. The namespaces are the grants configuration states (§3.4), which A2 already makes enumerable, so listing them tells the agent nothing an operator could not. The core namespaces every agent holds are left out.

Membership is what Mattermost holds now, never a copy that could drift from it.

### **3.12 Thinking**

Private reasoning is any intermediate model computation that is not emitted as user-visible output or as a tool invocation. Such reasoning:

- is never requested as part of an agent’s response;
- is never posted to Mattermost;
- is never included in an approval prompt;
- is never returned by `/collegium trace` or `/collegium inspect`;
- is never written to a log line.

It is stored beside the completion that produced it for one purpose: a thinking-mode provider refuses to continue from an assistant message whose reasoning it is not handed back, so the channel window replays it to the provider and to nothing else, unaltered. Where a provider reports reasoning-token usage, the framework may store the count.

**How hard a model reasons is configuration.** A model ref may state a reasoning effort in its provider's own vocabulary, and the framework states it to the provider in that form. Where config states nothing, the provider's default stands.

### **3.13 Mail**

An agent may act as **at most one email address**, fixed in its mail settings (§3.4). Which agents can send mail is therefore answerable by reading config alone. The mailbox boundary is enforced by the provider — credentials scoped to that one mailbox — never by the framework asking politely.

**Inbound is deterministic code, not an agent noticing.** A poll reads the mailbox on a configured interval and records one trigger row per arrival (§4.2); the system bot announces it when the channel is idle. On first connection the mailbox is read to its head and nothing is announced — existing mail is not news. After that nothing is missed, across restarts and extended downtime, and nothing is announced twice. Backlog drains at a bounded rate rather than all at once.

**An announcement shows the thread, not a wall.** The body is split at the boundaries the sender's client wrote and rendered as one blockquote: the newest message first under its real headers, then each quoted message under the sender, date, and subject its boundary carried, verbatim. The split is deterministic code, never an agent's reading. A boundary no rule recognises leaves the text where it is, still quoted, so an unknown client degrades to one segment rather than to dropped text.

**Handling an announcement marks the message read**, so the same item is not worked twice by a human and an agent. This rides the ordinary `triggers::resolve` path.

**Reading is ungated; sending is gated.** Listing, searching, and gathering a conversation return sender, subject, receipt time, and a short preview — only opening one message returns a body, and a body is never truncated by the mail tool; the one thing that may cut it is the turn's own context bound (§3.8), visibly, with the trace holding the whole. Bodies are presented as readable text whatever the sender's formatting. Attachments are described — name, type, size — and never opened; a request for their content is a typed refusal.

**Every send discloses what will leave**: the full recipient list, the subject, and the entire body, in the approval prompt (§3.7). Recipients are explicit arguments and there is no bcc field anywhere, so a recipient the approver cannot see is unrepresentable rather than merely disallowed. A reply stays in its conversation because the provider threads it, never because the model managed it. **Drafting is not sending**: proposing wording in conversation touches no mailbox and needs no approval. A mailbox may name an HTML template in its settings; the body is then rendered from markdown into it, raw HTML escaped, so the approved text is still all the model contributed to what leaves.

**A send is never retried.** A refusal the server answered — nothing left — is an ordinary result the agent may act on. An outcome that cannot be established is reported as unresolved and ends the turn (§7.1), because feeding "unresolved" back to a model invites exactly the duplicate the rule exists to prevent.

**Boot proves every mailbox, and distinguishes what waiting cannot fix.** An announcement channel that is a direct message or that the agent does not belong to, and credentials the provider refuses, are boot refusals naming what is wrong. A mailbox that is merely unreachable is not: the system bot says so in the announcement channel and the framework runs, polling until it recovers and saying so again when it does.

Mail is optional: a deployment with no mailbox configured runs exactly as it did before mail existed, and a partially configured one is refused before the system runs, naming what is missing.

### **3.14 Plugin**

A unit of operator-supplied capability living outside the framework: a directory of TypeScript sources mounted into the deployment, named in `config.json`, compiled and loaded once when the process boots. The framework performs orchestration and carries no business domain — a deployment's own concerns belong in plugins, so the framework upgrades without ever occupying the same files as what a deployment added.

**A plugin is a toolset (§3.4), and its layout is the declaration.** The directory's name is the plugin's namespace, its storage scope, and its skills' qualifier: one identity, stated once. Its config module declares the settings schema agents are configured by and the storage collections it owns; each tool file default-exports one tool named by its basename; each skill directory is a skill in the §3.5 layout. There is no manifest of contributions. A plugin does not alter how the framework activates agents, orders turns, budgets actions, or resolves approvals. Contributions appear under the namespace and agents opt in per grant exactly as with framework capability: installing a plugin grants it to no one. Framework namespaces are reserved.

**Refused, never skipped; failures are startup failures.** A file the conventions cover either loads or stops the process from starting, naming the plugin and the file. Nothing about a plugin is discovered mid-turn, and nothing malformed is silently left out.

**A plugin tool no agent is granted is warned of, not refused.** The state is legitimate — a tool may be held back on purpose — but it is also exactly the state a forgotten grant leaves, and nothing else surfaces it.

**Plugins are fully trusted; agents are not.** A plugin is operator-written code running with framework privilege — installing one is not different in kind from editing the framework, and the safety model constrains what an _agent_ may reach, not what an _operator_ may install. What a plugin decides is whether its tools gate (§3.7) and what the prompt shows; what it does not decide is whether its actions are seen — every plugin tool call is disclosed in the status post and recorded in the trace exactly as a framework tool's is (A5) — or how the framework budgets actions. A plugin's tool declares its gate explicitly — a render function, or `null` — and a tool that declares neither is refused: trust in a plugin is total (§9), which is exactly why what it claims must be legible.

**The boundary is structural.** A plugin imports `@collegium/sdk`, `zod`, and `node:` builtins — nothing else; every other bare specifier is a boot refusal. Both packages resolve to the framework's own copies, and each declared range is checked against the deployment's version at boot. A tool body returns plain text — or text beside a disclosure — and raises the only two failures it controls: `invalidArguments`, returned to the model, and `unresolved`, ending the turn as an unconfirmed side effect. A plain throw is a semantic failure like any other (§7.1). What the SDK does not hand over, a plugin cannot touch.

**Storage without schema ownership.** A plugin persists durable records in the framework's own store, scoped to its namespace, validated against its declared collection schemas on write and parsed on read — the one qualified read perimeter, because rows may outlive the schema that wrote them. It owns no tables, no migrations, and no database client, and cannot reach the framework's tables or another toolset's rows. A record carries the declared shape plus an `id`, `createdAt`, and `updatedAt` the store stamps; a taken id is refused, never overwritten; a patch is merged and the whole parsed again, so no patch leaves an invalid record. Beyond lookup by id, a collection answers one query grammar: an AND of conditions over top-level scalar fields — equality, membership, or a case-insensitive substring — with an optional limit, typed from the collection's own schema. A storage write can disclose itself by returning a disclosure (§3.4).

### **3.15 Work Unit**

**A durable record of one thing one agent handed to another, in one channel.** A unit carries the outcome wanted, the criteria its creator will judge the result by, the context the assignee needs, its creator, its assignee, and its state: `assigned`, `blocked`, `review`, `done`, `cancelled`. It is created by `tasks::assign` and by nothing else. There is no unassigned unit, because work nobody handed over is work an agent took on its own initiative (A3). Humans do not create units: a human's request is a post, and the agent that received it is accountable for it in the ordinary way. A question to a peer is a post too.

**Every state change is a post, and the post comes first.** The framework publishes the post under the acting agent's account, from a fixed template carrying model-authored fields — the arrangement §3.2 permits — and only then is the record written, pointing at that post. A change the channel never saw is therefore unrepresentable. A crash between the two leaves a post with no unit, which the next report finds and says, and the creator assigns again — visible where it happened; the reverse order would leave a unit the channel never announced, which is the one disagreement a work unit exists to prevent. An assignment addresses its assignee and a report addresses its creator, so both activate through the ordinary path and §7.4 counts them as it counts any other mention. A close addresses nobody.

**The assignee cannot close.** `tasks::report` reaches `review` and `blocked` and nothing else; `tasks::close` reaches `done` and `cancelled` and is refused for anyone but the unit's creator. A report is a claim and a close is a judgement, and one agent never makes both about one unit. A unit in `review` its creator judges incomplete is handed back as a fresh unit with corrected criteria, or closed as cancelled with the reason. The authority is read off the record: creator and assignee are fields, so no agent holds a role and there is no `lead` or `worker` anywhere in the configuration. `blocked` is for a blocker nobody in the channel can answer; an assignee held up by a question a person there can answer asks it (§3.7a) and keeps the unit.

**The open units are in the prompt, not in the scrollback.** Each turn's system prompt lists the units the agent created or was assigned in this channel and has not closed, oldest first, one line each; the full criteria and context are read on demand with `tasks::read`. This is how a supervisor remembers what it handed out and how a stalled unit surfaces, with nothing scheduling and nothing waking (A3). The list is capped by the toolset's settings; a unit is never truncated, the list is, and the remainder is stated as a count.

**A unit whose assignee runs out of context is reported blocked by the framework.** When a turn ends as context exhausted while its agent is the assignee of a unit in `assigned` in this channel, the framework reports that unit `blocked` through the path `tasks::report` takes, so the creator is activated. The unit is the one whose assignment post started the turn, or otherwise the agent's only assigned unit in the channel; where it holds several and none started the turn, none is reported, since the framework does not guess which work a turn was doing. The reason is fixed text, not the model's, because the model has just run out of room.

**An assignment is refused, not stripped, at a loop limit.** Where the turn stands at the §7.4 depth or chain-length limit, `tasks::assign` is refused before it runs and the agent is told why. Stripping the mention would leave a unit assigned to a peer that was never activated.

**The unit is not a second approval surface.** Assignment, report and close are ungated. A hand-off is not more consequential than the mention it replaces, the assignee's own actions gate on their own merits, and a gate on the structured path while the plain mention stays free would make the worse path the cheaper one.

## **4. Activation**

### **4.1 How Work Reaches An Agent**

All activation paths are Mattermost posts.

A scheduler calling the runtime directly would look compliant — everything downstream would still land in Mattermost — but the _occasion_ for the work would exist only in process memory: nothing to point at, and two ingestion paths forever.

### **4.2 Triggers**

External events do not post directly. Deterministic code — cron, mail polling, webhook — evaluates its condition and, when it fires, records a **trigger**: source, target agent, target channel, a reference (sender, subject, ID, and where the source carries one, the full body), and status.

**A schedule is declared, never created.** An agent's configuration names its schedules, each carrying a recurrence, a timezone, a channel the agent belongs to, and the text the system bot posts when it fires. Nothing about a firing is model-written: the announcement is the operator's own words, so it is the system bot speaking as §3.2 requires. A schedule that comes due while the channel is busy is announced when the channel next goes quiet, rather than being dropped or stacked. An agent can no more add a schedule than it can add a tool (§9).

**A missed occurrence fires once.** A deployment that was down for a week announces one firing rather than seven, and a schedule declared this afternoon does not announce this morning. When a schedule's next occurrence is announced, the previous one is marked handled if the agent never did, so an outstanding list holds at most one firing per schedule.

**A reference carrying a body is disclosed in full**, inline while it fits the substrate's post limit and otherwise as an attached file the post names — the §6.2 rule from the other side. A preview the reader must open the source to complete makes the channel a notification rather than a record.

**A source may own part of resolution.** Marking a trigger handled runs the source's own completion first — mail marks the message read (§3.13) — and a failure there leaves the trigger outstanding rather than claiming work is done.

**A trigger is posted only when the target channel is idle** — no turn running, no approval pending, nothing debouncing. The system bot posts it, mentioning the agent, which starts a normal turn. If the channel is busy the trigger waits and is posted when the channel next goes idle. One post per trigger.

**A DM is never a trigger target.** The system bot cannot be a member of a DM, so delivery has no route there; intake refuses loudly rather than recording a trigger that can never be posted. Triggers announce unattended work, and unattended work belongs in a channel other humans can see. **Nor is a channel the target agent is not in**: the trigger would announce work that cannot be done and strand as permanently unresolvable.

**Nothing the system bot posts enters the queue** (§5.2). Idle-gating is what makes that safe: a trigger is never posted into a channel that cannot immediately act on it. Gating on _idle_ rather than merely on _no pending approval_ matters — an agent mid-model-call is equally unable to take the lock.

**Triggers are marked handled by the agent**, through a tool. Without this, the outstanding list only grows and the same item is re-posted after every turn.

**Why this does not violate A1.** The trigger record holds things to be _announced_, not work to be _executed_. Nothing runs because a record exists; something runs because the system bot posted. For most sources the record is a cache — ground truth is the mailbox — though for webhooks it is the only record, which is an honest exception rather than a hidden one.

### **4.3 What The Scheduler Decides**

Trigger predicates are deterministic code. "Nothing to report" is resolved _there_, not by the agent — there is no path where an agent wakes, thinks, and stays silent, because that would be activity outside the substrate.

### **4.4 Folding Fragments Into One Turn**

People type in fragments seconds apart. Context is assembled once, at turn start, so a fragment arriving after assembly is invisible to the turn it belongs to. Folding happens in two places, and the second is what makes the guarantee.

**Before the turn: a short window.** A brief delay, resetting on each message, precedes turn start, and further messages from the same human in the same channel during it are folded into the same turn's context. This costs nothing: the common case — a mention, then the request a beat later — is absorbed before any work has been done.

**During the turn: the running turn absorbs.** A fragment from the same human arriving while that turn is still on its first model call is handed to the turn rather than queued. The turn discards the completion that only saw the first sentence, re-assembles its context, and calls again. Waiting longer costs a human real time; absorbing costs only a discarded completion.

**Only an unaddressed post is absorbed.** A fragment rarely repeats the mention, so this is what separates a sentence being finished from a request being made; the distinction cannot be drawn on elapsed time, since a model call may run for minutes. A post that names the agent again is queued and acknowledged exactly as §5.2 says, because absorbing it would silently drop work — nothing about absorption is durable.

**Absorption ends at the first action.** Once a tool has run or a post exists, discarding would throw away work that already had effects, so the turn stops absorbing and anything later takes the queue path. A **fold limit** bounds it from the other side, so a human typing steadily reaches an answer instead of paying for one completion per sentence. Past that point the human's route into the running turn is `/collegium steer` (§7.5).

**Absorption is scoped to the turn's own author.** Unrelated conversation in the channel is recorded and reaches the next turn's window; it never costs a running turn its completion. Fragments arriving when no turn is absorbing are handled by the queue instead (§5.2), which drains them into one turn.

**Neither kind of folding is a queue.** Nothing durable is created on either path, so a crash loses an absorbed fragment; the post is recorded, but nothing re-activates it. The window has a ceiling for the same reason the fold limit exists — without it, a human typing steadily never gets a response.

### **4.5 Multi-Agent Mentions Are Refused**

A post mentioning **two or more agents present in the channel** starts no turn and enters no queue. The system bot posts a mechanical correction: address one agent per message, and how to name an agent without addressing it — write the handle in backticks, which is no mention in Mattermost's grammar.

Mentions of agents not present in the channel are inert text: an absent agent never receives the post, so the harm this rule prevents cannot arise. A DM therefore never trips this rule.

_Why:_ two agents working the same task produce two approval prompts for overlapping actions, and the second gets approved having half-read the first. Picking the first-mentioned agent would be arbitrary, since mention order carries no intent.

_Why, more consequentially:_ **this rule is what pins delegation width at one.** §7.4 bounds the depth of an agent-to-agent chain and says nothing about its branching factor. If a turn could address three peers, ten levels would be tens of thousands of turns and the hourly ceiling would be the only brake. The depth limit bounds total work only because every turn can delegate to at most one colleague.

For agent-authored output the check happens at post time. The post is rejected and fed back to the model as a rejected post, because the model produced valid output violating a framework rule it cannot see, and one retry is cheap.

**A reply longer than a post can carry is rejected the same way.** A final output over the substrate's post limit (§6.2) is fed back as a rejected post stating the limit and the reply's length, and the model answers again more briefly, or replies with the first part and says what remains. It is never truncated: a reply cut to fit reads as a whole reply that says less, which is the quiet degradation A4 forbids. A post a tool returns (§3.15) over the limit is refused as its result.

**The bound is per turn, not per post.** A turn addresses at most one peer, however many posts it emits: a second post naming a different agent present in the channel is refused exactly as a post naming two of them is, since two addressing posts would produce the two concurrent turns this rule exists to prevent. The same peer addressed twice in one turn is one addressee.

**Two rejections in a row, then the turn ends** with a deterministic notice under the agent's name. A rejected post spends one action attempt (§5.3). The dedicated count exists because the budget's bound is the wrong one to rely on here: twenty-five rejected posts would reach the extension prompt with a number that says a turn worked hard rather than that it failed the same way repeatedly. A tool call that runs between two rejections resets the count. Every cause shares the one count — the mentions above, a tool call written as prose, output cut at the limit (§7.1), a reply longer than a post, a call naming a tool the agent does not hold (§7.2) — because a model alternating between them is exhibiting one behaviour.

Agent mentions in transient status text are stripped before posting. Status text never addresses anyone.

**Detection and stripping share one grammar, and that grammar is Mattermost's.** What the framework treats as a mention is what the client highlights and notifies; anything else acts on a mention the human never saw, or ignores one they did. The two paths diverging would defeat both the width bound above and the depth limit in §7.4.

## **5. Execution Model**

### **5.1 One Turn At A Time, Per Channel**

**An agent executes strictly one turn at a time within a given channel.** While a turn is live — waiting on the model, executing a tool, or blocked on approval — that channel is closed to further turns for that agent. Other channels are unaffected.

The channel is therefore the concurrency unit. It is also the intervention unit (§7.5) and the context unit (§3.8). The cross-channel exceptions are memory (§3.6), search (§3.8), and the global rate ceiling (§7.4).

Only one approval prompt can ever be live for a given agent in a given channel, which is what keeps approval resolution unambiguous.

**Within a turn, a completion's calls run in the order the model made them, except that a run of consecutive `concurrent` calls (§3.4) runs together.** Every call of such a run is admitted to the budget before the run starts, so the extension prompt still blocks in order and never twice at once, and the results are recorded in call order. A gated call is never concurrent.

### **5.2 The Queue**

A message addressed to a busy agent is **queued, not dropped**. The framework acknowledges it with a 👀 reaction on the post — not a reply, because a post per queued message would be noise in a channel where approval prompts also live.

An unaddressed fragment the running turn absorbs (§4.4) is neither queued nor acknowledged: the turn is already answering it. A post that addresses the agent is always queued and acknowledged, however busy the agent is.

**Drain, not pop.** When a turn ends on an exit that allows progress (§7.1) and the channel goes idle, everything queued for that channel is consumed by a single new turn. Ten fragments queued during a long turn become one turn, not ten.

**What the finished turn already read is consumed, not drained.** A post can be queued and still be read by the turn it queued behind, when it arrives before that turn's context is assembled. When such a turn completes normally and nothing has been recorded in the channel since its context was assembled, the queue entry is consumed and no turn starts, because a second turn would assemble the same window and say the same thing again. A post recorded after the assembly began was never read and drains as before. Any exit but normal completion drains as before too, since a turn that stopped or failed did not finish answering what it read.

**The drain is visible even when context is not.** When the window cannot reach back as far as the earliest unprocessed post, the draining turn's status post says how far back context actually reached — detection, not prevention, the same posture as memory-write disclosure (§3.6). What the window could not reach, the agent can search for (§3.8).

**The queue holds pointers, not content.** It records, per agent and channel, that unprocessed work exists and where context must reach back to; the content arrives through the normal context path. Delete the queue and it rebuilds from posts, which is why it does not violate A1.

**Nothing from the system bot is queued.** Triggers are governed by idle-gating (§4.2) instead.

**The backlog is unbounded and nothing expires.** If approvals are slow, work accumulates behind them indefinitely. The alternative is silently discarding work, and the failure mode of an unbounded queue is visible — a channel that has been busy for a day is obviously busy.

### **5.3 Action Budget**

**A fixed number of action attempts per turn**, set for the deployment and overridable per agent. An action attempt is one model-emitted tool invocation, _including invocations denied before execution._ Not counted: framework transport retries, framework posting, and the tools declared budget-exempt (§3.4) — `skills::load` and `memory::read`, the exemption being for loading context the framework already holds.

On exhaustion the agent posts what it has and requests approval to extend. Approving grants the agent's budget over again and preserves accumulated context. Extensions are unbounded in number, but each prompt carries the running count, because the human in the loop is the control, and the control needs the number.

_Why the budget is per agent:_ the number is a statement about a role. An agent whose unit of work is a hundred ungated reads either pays that number once, in configuration, or pays it as four extension prompts answered by a human who has stopped reading them, which is the gate degradation A5 names. A declared budget is enumerable by reading config (§6.1) and buys an agent nothing it was not granted: every gated call still blocks. The default stays low because the default agent is a conversational one.

**Denying an extension ends the turn's actions, not its voice.** A bare denial terminates. A denial with reason feeds the reason back with zero attempts remaining (§3.7), so the agent may conclude in words but not in actions. A tool call emitted after a denied extension ends the turn as budget exhausted and does **not** prompt to extend a second time, since a second prompt would let a denial buy an unbounded loop. Steering buys words, never budget (§5.4).

_Why a ceiling at all, given every consequential call is gated:_ **reads are ungated.** An agent can execute forty searches and file reads without touching the approval gate, and the first visible sign is whatever it concluded. Frequent limit-hits are information: the tools are too fine-grained or the task is too large.

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

**Shell confinement is OS permissions, not a path check.** `shell::run` runs each command as a dedicated OS user derived from the agent's username, never as the app's own user, and two agents can never share one. At boot the framework probes every shell-holding agent and refuses to start if its OS user is not provisioned, so a misconfigured host fails loudly rather than on the first command. **The approved bytes are the executed bytes**: the command runs in an argument slot of its own that no intermediate shell parses, so nothing the approver read as a literal is expanded on the way (§6.2).

**Confinement from framework code is traversal, not a path check either.** The app root is not traversable by any agent OS user, and the plugin root is beneath it, so framework code and operator-supplied plugin code alike are unreadable to the accounts `shell::run` executes as.

### **6.2 Approval**

The residual: irreversible, externally-visible, or shell actions block for consent (§3.7).

**Known limitation: approval verifies the call, not the content.** `workspace::write("notes.md", <900 words of confident nonsense>)` is a well-formed, in-bounds, correctly-scoped invocation. The tool has no opinion about whether the prose is true.

Two conditions therefore hold, or the gate becomes theatre:

1. **The read-only floor stays generous.** Gating pure observation multiplies prompt volume with zero risk reduction, and volume is what kills the gate. This is why the workspace has read tools beside `workspace::write` (§3.4).
2. **The prompt shows the payload in full.** A payload nobody can read is a payload nobody is checking. Where a payload exceeds what a single post can carry, the prompt shows a bounded prefix inline and the complete payload as an attachment — the approver sees the exact bytes rather than a rendering of them. A payload shown as code is fenced so that no payload can close its own fence, since text after an early close would render as Markdown, where a link shows its words and hides its target.

**The payload limit belongs to the substrate, not to us.** Mattermost's post size is a server setting an administrator can change, so it is read at runtime. Hardcoding it makes the gate silently wrong the day it moves, and raising it is not a remedy: it moves the cliff rather than removing it.

Shell commands are never attached, hidden, or truncated. They are presented inline and in full, and a command too long to present is refused — a shell command that will not fit in a post is itself the signal.

### **6.3 Reversibility**

There is no undo. `workspace::write` and `shell::run` act only inside confinement that holds nothing of independent value — the former within the agent's workspace directory, the latter as a dedicated OS user in its own home — so nothing there can be destroyed. Purpose-built tools that write to real systems are individually reviewed with fixed write targets; recovery on those paths is the underlying system's problem, not the framework's.

### **6.4 Callback Endpoints Trust The Network**

The decision, command and trigger endpoints require a shared secret on every request, in addition to trusting the network. The port must still not be publicly routable — bind the loopback or a private interface and let Mattermost reach it over that path; the secrets exist because that binding controls host exposure, not exposure within the deployment's own network. There are two secrets, separated by the authority each confers. Mattermost's is carried by the command route and, as a signature over one approval rather than the secret itself, by the decision route, so it is never written into a post. A trigger sender's is accepted on the trigger route and nowhere else: a webhook integration holds a credential that can announce work and cannot approve an action or stop a turn. It is optional, and its absence closes the route rather than opening it.

## **7. Failure And Recovery**

### **7.1 Failure Taxonomy**

Every way a turn can stop, and what the human sees:

- **Normal completion** — model emits no tool call. Ends. Visible as the final post.
- **Denial** — human clicks Deny. Ends. Prompt rewritten to a terminal state; the agent posts asking how to proceed.
- **Budget exhausted** — the agent's action budget spent (§5.3). Blocks on an approval to extend; denial ends the turn's actions, leaving it a final word only (§5.3).
- **Transport error** — timeout, 5xx, rate limit, a completion the provider itself interrupted mid-stream, or one that arrived malformed (§7.2). Retried invisibly; nothing is shown unless retries exhaust or a rate limit asks for a longer wait than the policy allows.
- **Output cut at the limit** — the provider stopped the completion at its output ceiling. Not output, since the model never finished, and not a failure: it is fed back as a rejected post (§4.5), spending one attempt, and the model answers again more briefly.
- **Semantic error** — a tool that threw, or a completion still malformed once its transport retries are spent (§7.2). Ends immediately. Error posted under the agent's name. A call whose arguments the schema refuses, a well-formed call whose _value_ the domain refuses, and a call naming a tool the agent does not hold are each a result the model reads instead (§7.2). A call whose argument text never parsed at all is forgiven once and ends the turn here on the second. Output the framework refuses to post, twice in a row, ends the turn here too.
- **Side-effect ambiguity** — a mutating call times out. Ends, with an explicit statement that completion cannot be confirmed.
- **Provider outage** — completion fails after retries. Ends. Failure posted under the agent's name, naming the transport cause as one fixed phrase per cause — connecting timed out, the provider went quiet, the address did not resolve, the connection was refused, the provider rate-limited the request with the wait it asked for — never the runtime's or the provider's words (§3.2). The distinction between _connecting_ and _responding_ is the one an operator acts on.
- **Provider rejection** — the provider refused the request itself: a 4xx other than a rate limit, or a filtered completion. Ends. Never retried, since the same request would be refused again. Failure posted under the agent's name, naming the class of refusal — a refused credential, an exhausted balance, a permission or moderation refusal, or the status by number — as one fixed phrase per class. A refusal for the request's _length_ is context exhaustion instead.
- **Context exhausted** — the turn accumulated more than its model's window can hold, whether measured by the framework or reported by the provider. Ends. Posted under the agent's name, saying the turn ran out of room part-way through and pointing at the trace — or, where the starting context itself did not fit, that the context budget and the model disagree, which is configuration rather than anything the turn did. Never retried. A turn working a delegated unit also reports that unit blocked (§3.15). The queue drains, since exhaustion is a fact about one turn's accumulation, not about the channel.
- **Delivery failure** — the chat substrate refused a post the turn had to make. Ends, carrying the substrate's own reason. This is **not** a provider outage: naming the wrong system sends the reader to the wrong place. Where there is no post to point at at all, the failure is loud in the operational record even though the channel stays silent.
- **`/collegium stop`** — human command. Ends at the next iteration boundary. Stop notice posted.
- **`/collegium kill`** — human command. Ends immediately; an in-flight completion is aborted, an in-flight tool may still complete.
- **Global halt** — hourly ceiling breached. All agents stop; prominent post; requires `/collegium resume`.
- **Restart** — deploy or crash. All in-flight turns abandoned; one system-bot notice in the main channel.

**A failure post names what the turn may already have changed.** Where a turn ends on a failure after calls to tools not declared `retryable` — which §7.2 reserves for reads — ran to completion, the post names each such tool and how many times it ran, and tells the reader to check their effects before running the work again. The natural reading of a failure is that nothing happened, and a turn that wrote before it died makes that reading wrong in a way nobody sees until the duplicate. A denial, a stop, a kill and an exhausted budget carry no such line: a human caused or watched each of them, and the status post already names the same calls on its closing edit (§8.1).

In every case the channel lock is released. The queue drains into a fresh turn only when the exit allows progress — normal completion, denial, budget exhaustion, context exhaustion, `/collegium stop`, `/collegium kill`. After a provider outage or rejection, semantic error, side-effect ambiguity, or delivery failure — and while a global halt stands — the queue is left standing: a fresh turn would inherit the same failure, and a drain loop bounded only by the hourly ceiling would halt the whole framework over one dead provider. A standing queue drains at the next human post, the next idle trigger flush, or the boot/`/collegium resume` sweep — all human-visible moments. A human post that arrived while the failed turn ran counts as that next post, so the queue drains the moment the lock is released. One drain per human post keeps this bounded — a fresh turn that fails again has nothing new behind it and stands. A peer's mention earns no such drain; it waits for a human. There is no retry timer: a slow retry loop is still the graceful degradation A4 rejects.

### **7.2 Retry Policy**

**Retry the transport, never the intent.**

Transport errors (timeout, 5xx, rate limit, a completion interrupted mid-stream) are retried transparently: a bounded count with backoff, invisible to the model, not counted against budget. **A rate limit that says how long to wait is waited out as asked**, up to the policy's longest single wait; one asking for longer ends the turn at once as a provider outage naming the wait, because a wait that long is the silent stall A4 rejects. A request whose turn has been killed is never retried.

**A malformed completion is retried as transport.** A stream chunk that does not parse, a call with no id or no name, a reply carrying neither text nor a call: each is a delivery the provider got wrong, not an intent the model formed, and nothing has acted on it. A completion that is still malformed once the retries are spent ends the turn as a semantic error. The argument text of a single call is the one exception, forgiven inside the turn instead (below).

**Every completion streams, under an idle timeout.** The inference timeout bounds how long the provider may send nothing, not how long the completion takes. A model that thinks for ten minutes and keeps streaming is served; one the provider has stopped serving is cut and retried.

**A tool that throws ends the turn.** Its body failed in a way it did not return as a result, so whether it acted is unknown.

**Arguments the schema refuses are answered, not ended on.** A call for a tool the agent holds, whose arguments parse but fail the tool's schema, returns one result naming what the schema refused, and spends an attempt (§5.3). The call reaches neither its gate nor its body. Every reshaped call is validated, gated and billed as before, so no sequence of guesses reaches anything the agent was not granted, and the budget is what stops a model that never converges.

**A name that resolves to no tool is answered, not ended on.** A call naming a tool the agent does not hold, under every spelling §3.4 admits, returns one result: the name it used, and the tools it can call. It spends an attempt and counts toward §4.5's count of rejections in a row. Misnaming a tool is the ordinary error of a long context, and ending the turn over it ended whole supervised runs over a typo; resolution is a lookup over the agent's own grants, so no guess calls anything it was not already granted.

**A value the domain refuses is a result too.** A well-formed call whose value the domain refuses — a description over its cap (§3.6), a trigger not addressed to this agent (§4.2), a path outside the workspace (§6.1), a skill outside the agent's manifest (§3.5) — is returned as the tool result, the turn continuing on its remaining budget. A refused invocation is still an invocation and still costs an attempt.

**Argument text that never parsed is not a shape the model chose.** A call whose arguments did not parse as JSON at all is a byte-level accident, not a model guessing at an interface. It returns one result — that the arguments were not valid JSON and the call did not run — and spends an attempt. **The second such call in the same turn ends it**: one is a mistake corrected; two says this call's arguments are not surviving the trip. The tool body never sees the broken arguments, and the provider's raw text is never read back to the model.

**A refusal never enumerates accepted values the agent was not already shown.** A domain refusal names what was refused and never lists what would have passed, because a valid set echoed back on failure turns a boundary into something to guess at. A schema refusal may quote the tool's own schema back, and the unknown-name result lists the tools the agent holds: each restates what the model was already given.

**Never retry a call that may have committed a side effect.** If `mail::send` times out, we do not know whether the mail went. The turn terminates and posts the ambiguity explicitly. This is why `retryable` is a per-tool declaration: reads yes, mutations no.

### **7.3 Restart**

**Nothing resumes.** All in-flight turns are abandoned; every agent boots idle.

_Why not resume:_ tool calls are not idempotent, so re-running a turn risks sending the same email twice. Checkpointing instead produces intentions formed against a stale world — an approval clicked at 6pm executing a plan assembled at 9am.

On boot:

1. **The status post of every abandoned turn is closed**, under the agent's own name: its working line becomes an abandoned one, so the turn's own post says which work the restart cost. A turn that called no tool leaves nothing behind.
2. **Pending approval prompts are invalidated.** The post is edited to a dead state and its buttons removed.
3. **Backfill** runs per channel from the last recorded post forward (§8.2).
4. **The roster reconciles** against Mattermost (§3.11).
5. **The system bot posts one boot notice** in the main channel, stating the downtime window, that in-flight work was abandoned, and how much of it was queued again (below).

**The downtime window is measured against the process, never inferred from activity.** A clean shutdown records its stop time; a crash leaves only a periodic liveness stamp, and the notice then says _since last known alive_ — honest about which of the two it is. Deriving the window from the last observed post would report a quiet channel as a day of downtime.

**Boot also verifies what it is about to trust.** For every model a configured agent names, one minimal completion is issued through its provider before the framework serves Mattermost events, and boot refuses if the provider rejects it as unauthorized, naming the model and the agents it strands. An answer that is neither acceptance nor refusal within a short deadline is recorded as unverified, never as verified, because a check that could not run must not read as a check that passed (§A4).

Queue state and outstanding triggers both survive a restart, so pending work is not lost to a deploy — it drains once channels go idle.

**An abandoned turn that had not acted is queued again.** A turn to which no completion had yet come back changed nothing, so the post that started it goes back into the queue and the boot sweep drains it into a fresh turn. This is not resumption: the fresh turn assembles its context from the channel as it stands after the restart. A turn with a completion recorded is abandoned as before, since it may have called a tool or posted its answer. A turn a trigger started is not queued again, since nothing from the system bot is queued (§5.2). Without this, a deploy landing between a delegation and the worker's first action leaves the delegation answered by nobody.

### **7.4 Loop Control**

Agent-to-agent mentions make unbounded chains possible: each turn is individually well-behaved and under budget while the chain runs until someone notices.

Two counters bound them, both carried in the turn record and never shown to the model. **Depth** measures how far work has been handed _down_ from a human; **chain length** measures how many turns one human post has produced at all.

**Depth counter:**

- Human-initiated turn → depth 0
- Trigger-initiated turn → depth 1 (a cron is not a human; unattended work is the dangerous kind)
- Agent-initiated turn → parent depth \+ 1, **unless the mention is a return**, in which case the depth of the turn being returned to
- At the configured limit, agent mentions in output are refused and the turn posts visibly that it has reached the delegation limit and someone needs to pick this up.

**A return is an answer to the turn that asked.** A mention is a return when the post carrying it was authored by a turn whose own triggering post was authored by a turn of the agent now being activated: Sam asks Naomi (Naomi at depth 1); Naomi mentions Sam (a return: Sam back at depth 0). Had Naomi mentioned Omar instead, that is a hand-off, and Omar is at depth 2. Depth therefore counts nesting, not exchanges — a supervisor that delegates one unit at a time and verifies each result sits at depth 0 for the whole run, its worker at depth 1. The test is mechanical and read off the store; no configuration declares a supervisor, so the shape can never be claimed by an agent or drift from what the channel shows. The same discipline governs who may close a unit of delegated work (§3.15).

**Chain length:**

- Human-initiated turn → 1, and the turn is the root of its chain
- Trigger-initiated turn → 1, and the turn is the root of its chain
- Agent-initiated turn, return or hand-off → parent chain length \+ 1, carrying the parent's root
- At the configured limit, counted as the turns carrying one root and enforced when a turn is opened, an agent's mention in output is refused first, as the friendly stop — and a hand-off through a work unit (§3.15) is refused before it runs — the turn posting visibly that the chain has reached its limit. A turn that would still exceed it is not opened, and the system bot says so in the channel, naming the agent that was not activated; a fresh human post starts a fresh chain.

**Chain length is what returns make necessary.** With returns free of depth, two agents could answer each other indefinitely at depths 0 and 1, and the only brake would be the hourly ceiling — an emergency stop, not a design. The chain-length limit is the bound on total unattended work one human post may set in motion: continuing past it costs exactly one human-visible act, which is the property every other limit in this section has. The number is deliberately far below the hourly ceiling, so that a legitimate long run is refused by its own limit rather than halting every agent in the framework.

**Depth bounds the chain only because §4.5 bounds its width.** Every turn may address at most one peer, so ten levels is ten turns, not ten levels of a branching tree.

**Chain length is counted by root, not along a path**, because a chain may have two turns running at once (§3.15) and two checks made at output time could both pass at the limit; admission is the guarantee, and the refusal at output is the early, agent-voiced stop. A turn with no recorded root is its own root: a restart does not continue a chain (§7.3).

Enforcement is in the framework, not the prompt. Prompt-level constraints are advisory, and advisory constraints are what produced Hermes.

**Global ceiling: a configured number of turns per hour, framework-wide.** Breach halts all agents, posts prominently, and requires an explicit `/collegium resume`. A halt invalidates pending approval prompts, as a restart does. While a halt stands, queues do not drain and triggers are not flushed — a trigger posted into a halted channel would strand. On clearing, `/collegium resume` runs the same drain-and-flush sweep boot performs.

**`/collegium resume` refuses only what it can objectively re-check.** A §3.10 topology violation is a fact about membership, so a halt raised by one stands until membership is fixed. A ceiling halt clears on the human's authority: a fresh allowance begins. The halt exists to stop a chain and put a human in front of it; once they have looked, their judgement is the control the system was routing to.

_Accepted cost:_ a loop that trips the ceiling is handed a fresh allowance every time someone resumes it. The compensating controls are that the halt post is prominent, the resume is attributable, and the running count is in front of whoever clicks.

**The rolling window is durable; the halt flag is not.** Turn starts are counted from the store over the trailing hour, and a `/collegium clear` (§8.5) keeps every turn record, so a clear is not a way to reset the count. The halt not surviving a restart is acceptable only because a restart breaks the loop that raised it; the ceiling is re-evaluated at the first turn start after boot and re-raises the halt if the window is still full, so a crash-looping instance cannot grant itself a fresh allowance every boot.

### **7.5 Manual Intervention**

All three commands are **channel-scoped and apply to all agents in that channel.**

`/collegium stop` aborts current turns at the next iteration boundary. The honest guarantee is _no further tool calls_, not _nothing happened_.

`/collegium kill` abandons current turns immediately: the turn record is closed and the channel lock released. A tool already in flight may still complete and its side effect may still land — `/collegium kill` is for a wedged process, and it accepts that ambiguity in exchange for immediacy.

`/collegium steer {text}` hands one instruction to the turns running in the channel, read before each turn's next completion. It is what §4.4 folding cannot be: folding discards a completion and reassembles from scratch, which is affordable only before the turn has acted. Steering keeps the work already done and appends — the instruction arrives as the human speaking, prefixed with their name as a post would be — but discards a completion in flight, since a plan made before the correction is exactly what the human is correcting. A steer **spends one action attempt**, so a human who keeps steering runs into the same ceiling a denial with a reason does (§5.3). The turn names the steer and its author on its status post, and the trace keeps the text. A tool already running is not interrupted, and a turn parked on an approval is steered by denying with a reason (§5.4), not by this command. With nothing running, the invoker is told so and the text is discarded rather than queued; §5.2 remains the one durable path for work.

_Why a command rather than a post:_ §5.2 says an addressed post is always queued and acknowledged, and that rule is load-bearing. A command is not a post: its response is ephemeral, it re-activates nobody, and it creates no obligation the framework then has to honour.

`/collegium stop` and `/collegium kill` post visibly; a steer is ephemeral to the invoker and visible through the status post. Any human in the channel may issue any of the three, since stopping is always safe and steering is no less safe than posting. Neither clears the queue: whatever was pending drains into the next turn.

**A command's own response is ephemeral**, so it never enters a channel as a post and cannot re-activate the agent it just interrupted. The visible notice is separate: posted by the system bot where it is present, and under the agent's own account in a DM, where Mattermost admits no third party (§3.2).

Either command also resolves a pending approval in the channel as **cancelled**: the prompt is rewritten to an invalidated terminal state, exactly as a restart does, and no follow-up posts. A cancellation is not a denial — denial statistics keep meaning that a human refused an action. This is how `/collegium stop` reaches a turn parked on an approval, which would otherwise be untouchable for days.

### **7.6 Stalls Are Announced**

Every exit in §7.1 posts, or was caused by a human watching. Three shapes end a run with nothing said at all, and leave the channel reading exactly like work in progress or work finished. The system bot names each in the channel it happened in. **It announces and never clears**: a notice that acted would be the recovery A4 rejects, and the human reading it is the one who decides.

- **A standing queue.** An agent has held a queue entry for a channel (§5.2) with no turn of its own running there for longer than a configured threshold. The notice names the agent and says what clears it: a post addressing the agent, and `/collegium queue {agent}` shows what waits.
- **A long turn.** One turn has held its channel's lock (§5.1) for longer than a configured threshold since it started or last waited on a person. Time parked on an approval or a question is not counted: that wait is its prompt's to announce, and its remedy is an answer, not a kill. The notice names the agent and how long, and says that `/collegium kill` ends a turn whose status post shows no progress.
- **A dropped hand-off.** A turn a colleague's mention started ends having published no post that mentions anyone. The colleague that asked is never woken, and the run ends there. The notice says the reply reached no one and names the colleague whose mention started the turn. It does not re-route the reply: a framework that re-addressed it would be deciding whom an agent speaks to.

Each is **one notice per episode**, re-armed only once its condition clears, so a standing condition is said once, not every minute it stands. Nothing is announced while a global halt stands (§7.4): its own post already says why nothing moves. An agent is named without its @, as every system-bot notice names one, because a mention from the system bot would activate the agent it describes (§3.10). In a DM the notice is posted under the agent's own account, as §3.2 permits.

_Why notices and not timeouts:_ each of these was a common way a long run died silently. A timeout that killed the long turn would also kill the legitimately long one, and a sweep that drained the standing queue would be the retry timer §7.1 refuses. Neither threshold is a limit the agent can see or work around: A3 is untouched, since nothing here starts a turn.

## **8. Persistence And Observability**

### **8.1 What The Human Sees**

**One status post per turn, edited in place** as the turn progresses. Tool calls are appended to it as they occur, so the post accumulates a readable trace of the turn rather than only showing current state.

**Each line names the tool and what the call is doing** — the URL navigated to, the path written, the command run — because a column of bare tool names says a turn was busy without saying what it did. Each tool renders its own one-line summary; the line is capped in length and the untruncated arguments are always in `/collegium trace`. The closing line also states how long the turn ran.

**The closing edit names what the turn may have changed.** Beneath the trace, one line lists the calls the turn completed to tools not declared `retryable` — which §7.2 reserves for reads — grouped by tool with a count. It is written on every exit, a normal completion included, from the framework's own names for the tools (§3.2). A turn's reply is model text, and can be wrong about its own effects in either direction; the line is the framework's record of them, set where the reader of the reply will look.

_Why not stream every tool call as a separate post:_ a ten-call turn would produce ten posts of machinery around one post of substance, and approval prompts live in the same channel — noise in the supervision channel degrades the gate (A5).

A memory write, its evictions, and a memory delete appear here as ordinary tool-call lines; what was written, evicted, or removed is in `/collegium trace` (§3.6).

Queued messages are acknowledged with a 👀 reaction (§5.2). This and the typing indicator below are the only signals the framework emits without posting.

**A typing indicator shows while the model is generating**, and through the §4.4 window, which is otherwise the one stretch where an agent has committed to answering and nothing says so. It creates no post and nothing durable. It is deliberately dark during tool execution and while an approval is pending: the status post and the approval prompt already account for that time, and an indicator held through a human's deliberation would claim work that is not happening.

_Why this and not an eagerly-created status post:_ a turn that calls no tool should leave nothing behind but its reply (A5), yet the human who addressed the agent is owed some sign that it heard them. An indicator that expires on its own satisfies both.

### **8.2 What The Store Holds**

**The store is authoritative for conversation content.** Context assembly reads only the store, never the Mattermost API on the turn path.

_Why a second copy at all:_ an agent's context is posts **interleaved with** tool calls, tool results, approval requests and decisions — its own turns' trace, never a peer's (§8.3). None of that exists in Mattermost except as rendered text, and split across two stores every context assembly becomes a merge across different clocks and ID spaces. One ordered store is a material simplification.

Stored: every observed post and the files it carried by name, type and size, every tool call and result, every approval request and decision, the triggers, the queue state, the work units (§3.15), and per-turn metadata (depth, chain length, action count, model, token usage). The file bytes are not stored: Mattermost holds them.

**Backfill on boot is required.** Posts made while the process was down are absent from the store. Each channel is backfilled from its last recorded post forward, **per agent, using per-agent tokens** — never a privileged token, or the framework would import posts from channels the agent has no membership in. Backfilled posts never trigger a turn but are context-eligible, as history rather than missed requests.

**Repair path:** slash commands typed in the channel rather than a SQL console, so repair stays visible and attributable.

_Known wrinkle:_ post edits propagate during downtime via backfill but not during uptime. Same event, different outcome depending on timing.

_Accepted losses:_ editing a post in the client does not correct what an agent believes; deleting a post in the client does not redact it from context — `/collegium clear` (§8.5) is the one deletion the framework performs and honours; a late-joining agent has no channel history before its join point, and search (§3.8) cannot find what was never stored.

### **8.3 Trace**

The complete tool trace — every call, arguments, and results — is retrievable via `/collegium trace {post-id}`, where the post is named by its id or by its permalink. **The response is ephemeral, visible only to the invoker**, because trace output contains file contents and email bodies verbatim, and everyone in a channel can also approve agents.

A trace carrying those payloads runs into the same substrate limit §6.2 does, and takes the same answer: where it exceeds what a single post can carry, it is delivered as an attachment, still ephemeral.

Reading traces is how the tool inventory gets tightened over time.

### **8.4 Command Surface**

Every command is a subcommand of one slash command, `/collegium`, so typing `/collegium ` offers the whole surface with an argument hint and a line of help per subcommand:

- **`/collegium trace {post-id}`** — full tool trace for a turn. Ephemeral.
- **`/collegium forget {post-id}`** — remove a post from agent context. Posts.
- **`/collegium clear [--memories]`** — delete every post in this channel and every agent's record of them, after a confirmation; `--memories` also deletes the memories their turns here wrote (§8.5). Posts.
- **`/collegium reset {agent}`** — mark an episode boundary. Posts.
- **`/collegium stop`** — abort current turns in this channel at the next boundary. Posts.
- **`/collegium kill`** — abandon current turns in this channel immediately. Posts.
- **`/collegium steer {text}`** — hand one instruction to the turns running in this channel, read before each turn's next model call; a call in flight is made again. Ephemeral; the turn names it on its status post.
- **`/collegium resume`** — clear a global halt.
- **`/collegium approvals [{agent}]`** — every approval still waiting on a human, in the channels you are in, oldest first, each naming the agent, the action, its age, and a link to its prompt. Ephemeral. The channel filter is the same membership check that decides who may answer one (§3.7). It decides nothing — the buttons on the prompt post remain the only way to answer.
- **`/collegium queue {agent}`** — show pending depth and the oldest unprocessed post. Ephemeral.
- **`/collegium queue {agent} clear`** — discard the standing queue entry, so the next drain does not run work a configuration change made stale. Posts. The posts themselves stay; only the pointer goes.
- **`/collegium triggers {agent}`** — list outstanding triggers. Ephemeral.
- **`/collegium memory {agent}`** — inspect and prune an agent's memories. Ephemeral.
- **`/collegium units {agent}`** — list an agent's open work units in this channel, with age and state (§3.15). Ephemeral.
- **`/collegium units {agent} cancel {reference}`** — close a unit as cancelled on a human's authority, for one whose creator will never reach it. Posts.
- **`/collegium inspect {agent}`** — show an agent's model, tools (marking which need a human on every call), skills, schedules with their next occurrence in the operator timezone, and system prompt. Ephemeral.
- **`/collegium usage`** — show token usage per agent and model, with cached-prompt and reasoning breakdowns and the cost the provider charged where it reports them, over turns that ended in the last 24 hours in any channel. Ephemeral.

A bare `/collegium`, or a subcommand nothing declares, answers the invoker with the list above.

**The command is held by a Mattermost plugin the framework ships, and the framework declares its subcommands to that plugin at boot.** The plugin knows nothing of the subcommands: it holds `/collegium` for a team, forwards every execution to the framework, and relays the answer. The framework's command definitions are the one source. Boot fails loudly if the plugin is not installed or the declaration is refused: a framework that starts without its stop switch is worse than one that does not start, and the failure would otherwise surface only as an opaque client error at the moment someone reaches for `/collegium kill`.

### **8.5 Clearing A Channel**

`/collegium clear` gives a channel a fresh start: every post in it is deleted from Mattermost, and every agent's record of it is deleted from the store. It is what `clear` is in a terminal, with one difference the substrate forces — a terminal forgets nothing, and this forgets everything, because the agents read the store and a human who sees an empty channel is entitled to assume the agents see one too. It applies to every agent in the channel, in a channel or a DM alike, and any member may run it, since membership is the whole authority model (§3.7). It is the one deletion the framework performs and honours.

**Content goes, accounting stays.** Deleted: the posts, the trace events of every turn here, their approvals and asks, the episode boundaries, the queue entries, the work units (§3.15), and the triggers that already posted here. Kept: the turn records, with what they cost and how long they ran, so the §7.4 hourly count and `/collegium usage` read exactly as before. Kept too: the files agents wrote, plugin storage, mail, schedules, the global halt, and triggers still pending, which post into the cleared channel when the idle gate opens, since they are future work rather than history. Search from any channel no longer finds what was here, because it is gone rather than hidden.

**Memories are kept by default.** Memory is the agents' work product, not the channel's record, and the path by which knowledge deliberately crosses channels (§3.6); the human saw each write when it was kept. `--memories` deletes those written from turns in this channel, selected by provenance — exact for an entry written and revised here, approximate at the edges, since a revision carries the revising turn's provenance. `/collegium memory {agent}` remains the way to prune one on purpose.

**A confirmation dialog stands before it.** It states what goes and what stays, in two sentences. Every other command runs on a keystroke because every other command is safe or reversible; this one is neither.

**It refuses while any turn runs here**, including one parked on a decision. It does not stop or kill: §7.5 gives those two different guarantees, and the human chooses between them. On confirmation it takes every agent's channel lock (§5.1), so no turn can start until the store is cut.

**The notice is the boundary.** It is posted first, by the system bot where present and under the agent's own account in a DM (§7.5), and if it cannot be posted nothing is changed. Everything older than it goes; a post that lands during the clear is newer than the notice and survives in both stores. The store is cut before the posts are deleted from Mattermost, and a restart backfills from the notice forward (§8.2).

**Failure is stated, never repaired.** A failure after the store is cut leaves a channel the agents have already forgotten and the human can still see — the honest direction — and the notice says so and how many remain. A failure before it leaves everything as it was, and the notice says that. In every case `/collegium clear` again is the repair: it finds nothing older than its own new notice in the store and removes what remains in the channel.

_Why deletion and not a boundary for everyone:_ a `/collegium reset` for every agent would hide the same content and delete nothing, and the store would hold what the channel no longer shows. "Cleared" has to be true of the database, or the command lies.

## **9. Deliberate Non-Goals**

**No self-modification of instructions.** Agents cannot write skills, system prompts, tool definitions, schedules, channel configuration, or model selection. Memory is the sole exception. A schedule is in that list for the same reason a tool definition is: it is the agent's own activation surface, and A2's guarantee that an agent's capabilities are enumerable by reading config extends to _when_ it acts, not only to what it may do. An approval would not repair this — every other approval in the system authorises one call, where a schedule authorises an unbounded number of future turns.

**Fixed model per agent, no fallback chain.** A provider outage means the affected agents are dead for the duration, failing loudly.

**No queue bounds and no expiry.** Backlog grows without limit and nothing goes stale. Accepted for a system with a small number of internal users; revisit if a channel is ever genuinely swamped.

**No plugin ecosystem, and no plugin sandbox.** No registry and no discovery: what loads is named in `config.json` and mounted by the operator, and nothing is fetched. `@collegium/sdk` is published so a plugin can be written in a repository of its own, and boot refuses a plugin whose declared SDK range the deployment does not satisfy. No isolation between framework and plugin: trust is total and deliberate (§3.14). Plugins do not depend on, extend, or communicate with one another; there is no lifecycle beyond startup — no hot reload, no enable/disable at runtime. Nothing in the system lets an agent write, install, configure, or enable a plugin — the prohibition on self-modification extends here unchanged.
