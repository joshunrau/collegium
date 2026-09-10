---
name: interacting-with-collegium-agents
description: Driving a Collegium agent on a live Mattermost instance. Use to log in, instruct an agent in a channel, inspect a turn, or debug a turn that failed.
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

Make each instruction complete by itself when the agent has no recent history of the task. The
agent sees a bounded window of recent posts, newest first. It does not see the whole channel.

## Read the result

One turn writes two kinds of post. Confusing them wastes the most time.

- A **status post** carries a marker. `⏳ _working…_` means the turn runs. The framework **edits
  this same post** as the turn proceeds. A terminal marker replaces it: `✅ _done_`, or a
  `⚠️ _stopped — …_` line that names the failure.
- The **reply** is a separate post with no marker. This is the agent's message to you.

So a poll that waits for a new post from the agent stops on the status post, not on the answer.
Wait for a post from the agent that starts with no marker. The harness has `awaitPostUpdate` for
the edit case.

The status post lists the tool names only. It is a summary. It is not the record.

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
- `/collegium queue {agent}` shows the posts that wait for the agent.

## Audit what the agent claims

A trace holds both what the agent wrote and what the agent read. Compare the two to test a claim.
Read [`AUDITING.md`](AUDITING.md) before you write the extraction.

## Approve a gated tool

A gated tool posts a message with buttons and waits. Any human in the channel can decide, so your
own account is sufficient.

Press a button with `POST /api/v4/posts/{post-id}/actions/{action-id}`. The action ids are
`approve`, `deny`, and `reason`. `approvals.renderer.ts` declares them.

Decide each approval on its declared action. An approval for a budget extension and an approval
for an outbound message are not the same decision.

## Pitfalls

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
