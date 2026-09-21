# What a live run adds

The API mechanics are in the `interacting-with-collegium-agents` skill. This file holds only what
differs when the instance is a deployment rather than the local stack.

## The driver

`scripts/driver.mjs` acts as one human account over the REST API. It reads the account from the
repo's `.env` (`CLAUDE_MATTERMOST_EMAIL`, `CLAUDE_MATTERMOST_PASSWORD`; the password may hold shell
metacharacters, so it never passes through a command line). The instance URL, team id, and the
test agents' user and channel ids are constants at the top of the file: look them up with
`POST /api/v4/users/usernames` and `GET /api/v4/users/me/teams/{teamId}/channels` and edit them for
a new instance. `RUN_DIR` (default `scratch/live-run`) holds the token, `run.json` and traces.

A task file's `{agent}` is the agent's username and `{FIX}` the fixtures base URL (`FIX` env).
Steps are `post`, `approval` (`approve`, `deny`, `deny-with-reason` with a `reason`; `repeat` covers
every later ordinary prompt but never a budget prompt), `ask` (an `answer`, pressed as an option
button when one matches, otherwise typed through `benchmark/scripts/dialog.js`), and `command`
(a slash command run in the channel between posts, e.g. a reset). A round-3 task also names its
`channel` (by name, or `dm:<agentKey>` for a direct message), the `agents` it runs on, and the agents
it `watch`es (a hand-off chain is several turns by several agents; the driver waits for a colleague a
watched post addressed, and settles when every watched agent's newest status post is terminal and
the channel has been quiet for forty seconds). Extra steps: `exec` runs a local command (a webhook
`curl` over ssh, `scripts/send-mail.py`, which sends a fixture to the agent's own mailbox from the
config named by `MAIL_CONFIG`), `watch` posts nothing and waits for the next turn (a trigger
announcement), and a `post` with `noWait` returns at once so a `command` or a second post can land
mid-turn after `delayMs`. `{channelId}`, `{TOKEN}` (env `TRIGGER_TOKEN`) and `{MAILBOX}` (env) are
substituted.

Round 3 needs, on the host: a second test agent holding `tasks` and `workspace` but no `web`; `mail`
granted to one tester (a mailbox is unique per agent, so move it from whoever holds it) with the
shared channel as its announcement channel; an hourly schedule; `turns.delegationDepthLimit` low
enough to reach; `notifications.stalls` lowered to 90 s; `TRIGGER_TOKEN` in `.env` followed by
`docker compose up -d app`, since a plain restart keeps the old environment. Recreate, do not
restart, and log every step with its revert. Never post the next task into a channel while a
colleague's turn is still running there: the post queues behind it and folds into that turn.

Classification the driver relies on: a status post starts with `⏳ _working`, `✅ _done`,
`⚠️ _stopped`, `🛑 _stopped`, `⏸️ _stopped` or `⏹️ _stopped`; a decision post starts with
`✅ **Approved**`, `↩️ **Denied` or `❌ **Denied`; a prompt carries `props.attachments[].actions`
and starts with `🔐` or `❓`; anything else from the agent with text is a reply. Empty posts and
posts with `delete_at` set are Mattermost's edit history of the status post, not the agent's.

A status post that never reaches a terminal marker is itself a finding (the call list can exceed
the post size limit, after which every edit fails); the driver treats a reply with no post update
for ninety seconds as settled and says so in the record.

## Fixtures

The app runs in a container on a bridge network: `localhost` inside it is the container, and the
web toolset refuses private addresses unless the deployed image supports and the config sets
`web.allowPrivateAddresses`. What worked: a Caddy site on a hostname that already resolves to the
host's public IP, plain HTTP, `root` on a copy of `benchmark/fixtures/northmoor`, `header
X-Robots-Tag "noindex, nofollow"`, and `@outside not remote_ip <hairpin source> <host ip>
172.18.0.0/16 127.0.0.1` answering 404. Learn the hairpin source by serving `respond
"{remote_host}"` on a probe path and fetching it from inside the container. Back the Caddyfile up
before appending, reload, verify 200 from the container and 404 from outside, and log all of it.

## Extraction

`scripts/extract-store.js` runs inside the container against `/data/prod.db` read-only (the image's
node has `node:sqlite`) and prints one JSON document of the rows keyed to the given channel ids and
agent names: Turn, TurnEvent (with reasoning), Post, Approval, Ask, WorkUnit, Memory. Nothing else
leaves the host. `scripts/slice.mjs` selects each entry's turns by `triggeringPostId` from
`run.json` and writes the artifact set a reader consumes.

## What to watch for

- **Loops.** A multi-page task with any model cycles the same few URLs with no assistant text
  until the budget. Read the status post's repeated lines; deny the extension with a reason; the
  reply that follows is part of the evidence. `/collegium steer` ends a loop within a call.
- **The shell as a page reader.** Models route around the web toolset through approval-gated
  shell calls; count those approvals, they are the human's cost.
- **Your own account name.** The window renders every author as `@username:`; an account named
  like an agent confuses the models about who is speaking.
- **Cost.** `/collegium usage` after the first multi-page task sets the ceiling for the run; a
  reasoning-heavy model on a looping task costs several dollars per task.
