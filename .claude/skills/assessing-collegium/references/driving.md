# Driving a run

The general mechanics of speaking to an agent over the Mattermost API (login, the session token in
the `Token` header, status post versus reply, pressing a button) are in the
`interacting-with-collegium-agents` skill; `app/e2e/support/channel.ts` holds the exact shape of
every call. This file holds what the benchmark adds.

## Accounts and addresses

Mattermost is `http://127.0.0.1:8066`, the app `http://127.0.0.1:3001`, both from `bench.env`, which
also holds the admin login you act under and the `TRIGGER_TOKEN`. Log in once; keep the token.

Provisioning creates the team, the bots, and every channel `plan.json` names, but it puts only the
system bot in a task channel (§3.9: membership is set by people). Before a task, resolve the ids
of its members with `POST /api/v4/users/usernames`, add yourself and each member with
`POST /api/v4/channels/{id}/members`, and look the channel up by name under the team with
`GET /api/v4/teams/name/bench/channels/name/{handle}`.

## Steps

- **post**: `POST /api/v4/posts` in the step's channel (`main` unless the step names another).
  Then wait for the agent's status post to reach a terminal marker and for a reply post from the
  agent with no marker. A post with `expect: refusal` is followed instead by the system bot's
  refusal post and no status post.
- **approval**: wait for the prompt post (it carries `approve`, `deny`, `reason` actions). `approve`
  and `deny` are `POST /api/v4/posts/{id}/actions/{action}`. `deny-with-reason` opens a dialog and
  needs the websocket: `node benchmark/scripts/dialog.js --action reason --field reason --text "…"`.
  With `repeat`, decide every later prompt in the task the same way. A budget-extension prompt is
  an approval like any other.
- **ask**: an ask prompt offers option buttons and an `answer` button. Press an option's action if
  the answer is one of them, else `dialog.js --action answer --field answer --text "…"`.
- **await trigger-turn**: nothing to post. Wait for the system bot's post in the channel, then for
  the agent's turn to end as above.

Setup, run before the first step:

- **mail**: send the message to the bench mailbox over SMTP with the mailbox's own credentials
  (Python's `smtplib` is enough; write the body to a file, never on a command line). The framework
  reads the mailbox to its head at first connection and announces only what arrives afterwards, so
  send after the stack is up.
- **trigger**: `POST http://127.0.0.1:3001/triggers` with `Authorization: Bearer $TRIGGER_TOKEN`
  and a body `{ targetAgentUsername, targetChannelId, reference }` from the task; the channel id is
  the task's `main` channel. The system bot posts it when the channel is idle.

## Waiting

A running turn edits its status post; the status post's `update_at` moving is the liveness signal.
Wait up to 10 minutes for a turn to end and 3 minutes for a prompt or a trigger post to appear.
Past that, write the time and what the channel showed into the task's `notes` and move on. Do not
post again, steer, stop, or kill: the stall is the result.

Between tasks, nothing is reset. Memories persist within the run by design.

## run.json

Written to the run directory, updated after every task:

```json
{
  "commit": "<git rev-parse --short HEAD>",
  "version": "<package.json version>",
  "tier": "reference",
  "startedAt": "<ISO>",
  "endedAt": "<ISO>",
  "tasks": {
    "b2": {
      "channels": { "main": "<channel id>" },
      "humanPostIds": ["<post id>"],
      "outcome": "terminal | stalled | skipped",
      "notes": "free text for anything irregular, or empty"
    }
  }
}
```

One run directory per tier: a `reference,control` run writes two, suffixed `_reference` and
`_control`, each with its own `run.json`, and the report compares them side by side.
