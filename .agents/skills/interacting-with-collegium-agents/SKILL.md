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
again, run `/collegium queue {agent}` (see [Inspect a turn](#inspect-a-turn)). It says whether a
turn is running for the agent in this channel, since when, and which post started it, then what
waits. Nudge only when it reports no turn running. A `⏳ _working…_` status post from the agent means
a turn is running, a `🔐` or `❓` _waiting…_ one means it is parked on a person, and 👀 on your last
post means it is queued; each answers without the command.

Make each instruction complete by itself when the agent has no recent history of the task. The
agent sees a bounded window of recent posts, newest first. It does not see the whole channel.

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

## Inspect a turn

Run a slash command with `POST /api/v4/commands/execute`, with `channel_id` and `command`. The
answer comes back in the API response as ephemeral text. It does not appear in the channel.

`app/src/commands/commands.definitions.ts` holds the current command list and the arguments of
each command. Read it rather than a copy here.

`/collegium trace {post-id}` is the only complete record of a turn. It gives the model, the
outcome, the arguments of every call, and the full result of every call.

**A trace of a working turn runs 300,000 to 550,000 characters.** Write it to a file. Then read the
file with a script. A trace read into your context directly costs more than the whole rest of the
task.

Two cheap commands answer most questions without a trace:

- `/collegium memory {agent} show {reference}` reads one memory body. An agent's memories hold its
  real state for a long task. The channel does not.
- `/collegium queue {agent}` shows whether a turn is running for the agent, and the posts that
  wait for it.

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
written survive. The messages the turn held in memory do not. The agent must read its memories
again to continue.

**A count in a report.** An agent reports a number of records. The trace holds the calls. Count the
calls before you repeat the number.

**A regular expression over a trace.** A non-greedy pattern over a JSON argument stops at the first
closing brace and silently undercounts. `AUDITING.md` gives the method that does not.

**Your own posts.** You act as a human, under the account you logged in with. Every post and every
command is attributed to that account and stays in the channel.
