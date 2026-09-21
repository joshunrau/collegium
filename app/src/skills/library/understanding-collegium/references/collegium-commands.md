---
description: All fifteen /collegium subcommands with their arguments, and which ones answer only the person who typed them. Load before naming a command to a person.
title: The /collegium commands
---

Only a person can run these. Typing `/collegium` alone lists them all with a line of help each. An
_ephemeral_ result is visible only to the person who ran it; the rest post to the channel.

## Seeing what happened

- `/collegium trace {post-id}` — the full tool trace for a turn. Ephemeral.
- `/collegium inspect {agent}` — an agent's model, tools with the ones that need approval marked,
  skills, schedules, and system prompt. Ephemeral.
- `/collegium usage` — token usage per agent and model, with cached-prompt and reasoning breakdowns
  and the cost the provider charged where it reports it, over turns that ended in the last 24 hours
  in any channel. Ephemeral.
- `/collegium queue {agent}` — pending depth and the oldest unprocessed post. Ephemeral.
- `/collegium approvals [{agent}]` — the approvals waiting on a person, for one agent or all.
  Ephemeral.
- `/collegium triggers {agent}` — outstanding triggers. Ephemeral.
- `/collegium units {agent}` — the open work units in this channel for an agent. Ephemeral.

## Changing what an agent sees

- `/collegium reset {agent}` — mark an episode boundary; context and search reach no further back.
- `/collegium forget {post-id}` — remove a post from agent context.
- `/collegium memory {agent} [show {reference} | prune {reference}]` — list an agent's memories;
  `show` reads one in full, `prune` deletes one. Ephemeral, and `prune` changes what the agent holds.
- `/collegium queue {agent} clear` — discard the standing queue entry, so the next drain does not run
  work a configuration change made stale. The posts themselves stay; only the pointer goes.
- `/collegium units {agent} cancel {reference}` — cancel one open work unit; the cancellation posts
  to the channel.
- `/collegium steer {text}` — hand one instruction to the turns running in this channel. It arrives
  as a person's post between the agent's results, and it spends one of the agent's action attempts.
  Ephemeral.
- `/collegium clear [--memories]` — delete every post in this channel and every agent's record of
  them, and with `--memories` the memories too, behind a confirmation dialog. The one destructive
  command.

## Stopping work

- `/collegium stop` — end current turns in this channel at the next iteration boundary. An action
  already in flight may still complete.
- `/collegium kill` — abandon current turns in this channel immediately; an in-flight completion is
  aborted, though an in-flight tool may still complete.
- `/collegium resume` — clear a global halt. A halt raised by a channel-topology violation stands
  until membership is fixed; an hourly-ceiling halt clears on the person's authority.

Choosing between stop and kill: stop lets in-flight work finish and is the default; kill is for a
turn that is wedged, and abandons whatever was in flight. Recommend stop unless the status post shows
no progress.
