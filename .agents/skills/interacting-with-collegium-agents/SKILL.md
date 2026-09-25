---
name: interacting-with-collegium-agents
description: Driving a Collegium agent on a live Mattermost instance. Use to log in, instruct an agent in a channel, poll a running turn, answer an approval or question it parks on, inspect a turn, or debug a turn that failed.
---

How to operate an agent on a running deployment, and how to read what it did without filling your
context. The agents are bots. You act as a human in the channel.

For the shapes of every interaction, `app/e2e/support/channel.ts` is the reference implementation.
It drives an ephemeral cluster, so you cannot reuse it against a live instance. Read it when you
need the exact shape of a call.

## Log in

The API is sufficient. Do not drive a browser.

Post the credentials to `/api/v4/users/login`. Two details cost time if you miss them:

- **The session token is in the `Token` response header.** The body holds the user record only.
- **A password can hold shell metacharacters.** Write the JSON body to a file and post the file.
  Do not put the password in a command line.

Then find the channel. Read `/api/v4/users/me/teams`, then
`/api/v4/users/me/teams/{teamId}/channels`. A channel of type `O` is a normal channel. A channel of
type `D` is a direct message and its name is a pair of user ids.

Map the author ids to names once with `POST /api/v4/users/ids`. The response tells you which
accounts are bots. Keep the map. Raw ids make a transcript unreadable.

## Instruct an agent

Post to `/api/v4/posts` with the channel id. Mention the agent as `@name`.

**Mention one agent for each post.** The framework refuses a post that mentions two agents.

A mention starts a turn. Nothing else does. After a turn stops, the framework starts no new turn
by itself, so an agent that writes "next I will…" waits for you. Post again to continue it.

**Read the lane before you nudge.** A quiet channel is not an idle agent: a turn that has called no
tool yet has no status post, and can run for minutes that way. A mention of an agent whose turn is
still running starts nothing. It queues behind that turn, the agent reacts 👀 to it, and the next
turn reads everything that queued, so a second nudge adds nothing to the first. Before you post
again, run `/collegium queue {agent}` for every agent in the channel (see
[Inspect a turn](#inspect-a-turn)). It says whether a turn is running for the agent in this channel,
since when, and which post started it, then what waits.

- The lane is idle only when no agent in the channel has a turn running. A colleague's running turn
  holds any hand-off it has addressed to this agent until it ends or parks (SPEC.md §5.2), so a
  nudge then queues a second turn over the same work.
- A turn parked on a person is decided, never nudged. `/collegium units {agent}` lists it under
  "Waiting on a person in this channel".
- When the lane is idle, run `/collegium units {agent}` for each agent and nudge the one whose move
  it is, naming the unit.

A `⏳ _working…_` status post from the agent means a turn is running, a `🔐` or `❓` _waiting…_ one
means it is parked on a person, and 👀 on your last post means it is queued; each answers without the
command.

Make each instruction complete by itself when the agent has no recent history of the task. The
agent sees a bounded window of recent posts, newest first. It does not see the whole channel. A
kickoff or resume post names the work's own record to read first (for example, a sweep plugin's
`get_sweep`) and the skill to load, never a memory.

## Countermand and pause with a steer

To change what a running turn does, steer it by name: `/collegium steer {agent} {text}`. The turn
reads the steer before its next model call, and a completion in flight is discarded. A delivered
steer replays in that agent's later windows as your words, so do not repeat it as a mention.

Post the instruction instead only when the steer's answer says no turn is running, when the turn
ended without the `↩ _steered by @you_` line on its status post, or when new work must start.

A turn parked on a person is redirected by denying with a reason, or by answering. `/collegium stop`
is for when no agent may make another call. Follow it with a post that says what happens next.

**A pause is a post and a steer.** No command holds a channel.

1. Post the pause in the channel first. Name no agent where the channel's triggering mode lets a
   post address nobody, so it starts no turn and every turn that starts there afterwards reads it.
   Never pin it.
2. Steer every turn running in the channel with the pause and its reason, for example "finish or stop
   what you are doing, and hand nothing over".
3. Read `/collegium queue` for each agent in the channel, and repeat until no turn runs there:
   - A hand-off that a steered turn posted before the steer reached it waits until that turn ends or
     parks. It then starts its addressee's turn at once, before any read of the queue can catch it.
     That turn shows as running at the next read: steer it with the same pause. Do the same for any
     turn its report starts.
   - A hand-off queued before the pause still starts its addressee's turn once that agent is free,
     since each agent's queue is its own. Stop one that must not run: cancel its unit
     (`/collegium units {creator} cancel {reference}`) and discard that agent's queue
     (`/collegium queue {agent} clear`). Cancel a unit the same way when its hand-off started a turn
     you then steered, and its work must not resume.
   - Pending approvals and questions stay live. Deny with a reason, or run `/collegium stop`, if they
     must not proceed.
4. To resume, post the next order, addressed to the agent that should act on it.

## Keep standing instructions in one pinned post

Every post pinned in a channel is rendered to every agent there on every turn, after the window, so
a pin outlasts the window. Keep one pinned scope post per channel.

- Post it naming no agent. It states the channel's remit in its tools' terms (for example, a sweep's
  id and its institutions and departments, never unit ids, since a follow-up unit gets a new id) and
  its standing rulings. It carries no progress and no counts.
- Keep it well under the pinned-post cap (`PINNED_POSTS_TOKEN_CAP` in
  `app/src/turns/prompt/prompt.constants.ts`). Past the cap the newest pins that fit are shown and the
  older ones are only named. Revise it in place, since an edit starts no turn. Pin it again after
  `/collegium clear`, which deletes pins with the posts. Never add a second pin for a pause or a
  ruling.

**Moving work between channels.** Before a move, run `/collegium units {agent}` in the giving and
the receiving channel, and move only work no channel has in flight. Edit every affected pin in one
pass. In the same pass, give the losing channel its next order or tell it to stand down.

## Memory holds lessons, not state or one channel's rulings

An agent's memories hold lessons that apply wherever it works. A ruling about one channel's work
lives in that channel's pinned scope post, never also in memory, so you edit it in one place. A
task's state is in the records its tools keep, and in the channel. Never order state into memory,
including in a pause. Name a memory reference in a post only when asking its owner to change it.

## Read the result

One turn writes three kinds of post. Confusing them wastes the most time.

- A **status post** carries a marker. `⏳ _working…_` means the turn runs;
  `🔐 _waiting on a decision since 14:05 EDT_` or `❓ _waiting on an answer since …_` means it is
  parked on a prompt. The framework **edits this same post** as the turn proceeds. A terminal
  marker replaces it: `✅ _done_`, or a `⚠️ _stopped — …_` line that names the failure.
- The **reply** is a separate post with no marker. This is the agent's message to you.
- A **prompt** is a separate post that parks the turn on a human: `🔐 **Approval required**` for a
  gated call, `❓ **Answer needed**` for `ask::human`. It carries buttons.

So a poll that waits for a new post from the agent stops on the status post, not on the answer.
Wait for a post from the agent that starts with no marker. The harness has `awaitPostUpdate` for
the edit case. The status post lists the tool names only. It is a summary. It is not the record.

A `⏱️ _a response ran past its N-minute limit_` line means one model completion was cut at the
agent's completion time limit and discarded, and the turn went on. A second in the same turn ends
it, with a notice naming the limit. A lane whose status post shows nothing new for longer than that
limit is stuck somewhere other than the model, and `/collegium kill` ends it.

## Poll for the three states

A turn is working, parked on a human, or finished, and its status post's marker says which:
`⏳ _working…_`, a `🔐` or `❓` _waiting…_ head, or a terminal marker. A park always follows a tool
call, so a parked turn always has a status post. To find every park at once, poll:

```
/collegium approvals          # approvals and questions in every channel you are in, oldest first, with each one's age
```

One call covers every track — pass an agent name only to narrow it. `/collegium units {agent}` and
`/collegium trace` name the same wait for one agent's work or one turn.

Decide a park the same minute you see it. Until someone does, the turn holds the channel lock, the
agent's queue grows behind it, and the sweep is stopped rather than slow.

## Poll for posts that mention you

An account on the API gets no mention notifications, and an agent often asks you something in a
plain post. Each poll fetches every channel's posts since the last read and lists the agent posts
that @-mention you anywhere in the text. Answer or explicitly defer each one at that poll.

- Cover every channel your account belongs to (`/api/v4/users/me/teams/{teamId}/channels`),
  direct messages included.
- Read each with `/api/v4/channels/{channelId}/posts?since={ms}`. It returns posts changed since
  then, so keep the ones whose `create_at` is past your mark and whose `delete_at` is 0.
- Keep a mark per channel on the server's `create_at`, and advance it only after the posts it passes
  are handled, so a restarted poller neither repeats nor skips one.
- Match your @handle as a whole word, and keep only posts from bots (`POST /api/v4/users/ids`).

## Inspect a turn

Run a slash command with `POST /api/v4/commands/execute`, with `channel_id` and `command`. The
answer comes back in the API response as ephemeral text. It does not appear in the channel.

`app/src/commands/commands.definitions.ts` holds the current command list and the arguments of
each command. Read it rather than a copy here.

`/collegium trace {post-id}` is the only complete record of a turn. Its head gives the model, the
outcome, what started the turn (a post addressing the agent, a drain, a colleague's hand-off, a
trigger, a resync or a sweep) and the posts it answered and drained from, how long it ran, the
window it read, and its tokens and cost. Beneath it come the arguments of every call and the full
result of every call, each with its offset from the start, and every reply the framework rejected
with the reason.

**A trace of a working turn runs 300,000 to 550,000 characters.** Write it to a file. Then read the
file with a script. A trace read into your context directly costs more than the whole rest of the
task.

Three cheap commands answer most questions without a trace:

- `/collegium memory {agent} show {reference}` reads one memory body.
- `/collegium queue {agent}` shows whether a turn is running for the agent, and the posts that
  wait for it.
- `/collegium units {agent}` lists the agent's open work units in this channel, whose move each
  waits on, and what waits on a person.

## Diagnose before you change anything

Save the trace of one failed turn and list its steps by size:

```sh
awk '/^[0-9]+\. \[\+/ { if (h) print n "\t" h; h = $0; n = 0; next } { n += length($0) + 1 }
  END { if (h) print n "\t" h }' trace.txt | sort -rn | head
```

A result marked `(the model read its first N characters)` was cut to fit the turn, and a cut or one
dominant result is the cause. Otherwise total the results by tool, by piping the listing, without
`head`, through:

```sh
awk -F'\t' '{ split($2, tool, "`"); total[tool[2]] += $1 } END { for (t in total) print total[t] "\t" t }' | sort -rn
```

- Post a cause only once a trace shows it, and a fix only after the failed work has run cleanly
  under it. Count the stop posts in every lane before you say a fix held.
- Name every agent a config change reaches: an `agentDefaults` key reaches every agent without its
  own value.
- Name only arguments the tool's schema declares.

## Audit what the agent claims

A trace holds both what the agent wrote and what the agent read. Compare the two to test a claim.
Read [`AUDITING.md`](AUDITING.md) before you write the extraction.

## Approve a gated tool

A gated tool posts a message with buttons and waits. Any human in the channel can decide, so your
own account is sufficient.

Press a button with `POST /api/v4/posts/{post-id}/actions/{action-id}`. The action ids are
`approve`, `deny`, and `reason`. `approvals.renderer.ts` declares them. An `ask::human` question
carries one button per option plus a free-text one, declared in `asks.renderer.ts`.

Decide each approval on its declared action. An approval for a budget extension and an approval
for an outbound message are not the same decision.

## After an upgrade

An upgrade invalidates stored procedure: a memory that restates how a tool behaved goes stale when
the tool changes. After the upgrade, and before the resume posts, ask each agent once to revise with
`memory::replace` the entries that restate a procedure that changed. Do it in one channel or a direct
message, while the agent's other lanes are idle; `/collegium memory {agent}` lists the entries. The
resume posts then name each procedure that changed, not only the tool mechanics, and ask for no
memory work.

## Remove an agent

Cancel its open units first, with `/collegium units {creator} cancel {reference}` in each unit's
channel. A unit whose agent is gone has nobody left to move it.

## Pitfalls

**A poll that waits for a terminal marker.** A `🔐` or `❓` _waiting…_ head is not one, and the
turn ends only after someone decides, so the loop waits out the whole park. Every polling loop you
write matches the waiting heads or asks `/collegium approvals`; see
[Poll for the three states](#poll-for-the-three-states).

**A turn that recorded no events.** `/collegium trace` answers "recorded no events" when the model
provider refused the first request. The post that started the turn can be consumed. Check
`/collegium queue {agent}` in the same minute. An empty queue and no events together mean the
instruction is gone, and the agent never read it.

**A `⚠️ _stopped — a call timed out with its effect unconfirmed_` turn.** The events already
written survive. The messages the turn held in memory do not. The agent must re-read the records its
tools keep to continue.

**A count in a report.** An agent reports a number of records. The trace holds the calls. Count the
calls before you repeat the number.

**A regular expression over a trace.** A non-greedy pattern over a JSON argument stops at the first
closing brace and silently undercounts. `AUDITING.md` gives the method that does not.

**Your own posts.** You act as a human, under the account you logged in with. Every post and every
command is attributed to that account and stays in the channel.
