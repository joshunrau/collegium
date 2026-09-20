---
name: live-benchmark
description: Run a bakeoff on a live Collegium instance and judge it. Use to probe a deployment's prompt, tools and mechanics across several models with fixed-answer tasks, produce a findings report for an implementer, or repeat the 2026-09-20 production run.
---

One run: serve the fixtures where the app can reach them, drive every task on every test agent
as the human, pull only their rows out of the store, have one reader judge each task-agent run,
have reviewers verify the findings against the code, and write the report. The unit of finding is
a defect or a subpar behaviour in what the framework controls; a model-only failure is noted at
lower weight. Nothing the run produces is committed: it all lives under `scratch/`.

The `assessing-collegium` skill is the same shape against a local stack with a generic roster.
The `interacting-with-collegium-agents` skill holds the API mechanics (login, posts, prompts,
traces); [`references/driving.md`](references/driving.md) holds only what a live run adds.

You are the lead. You drive, dispatch readers and reviewers, and write the report. You never read
an `events.json` or a whole trace yourself.

## 1. Prepare

- Name the run directory: `scratch/<date>_<instance>-bakeoff/`, with `server-changes.md` opened
  first: every change on the host, in order, each with the command that reverts it.
- Confirm the deployed image accepts every config key the run needs before touching `config.json`:
  a key that landed on main after the image was built crash-loops the app.
- Confirm each test agent holds no memories (`/collegium memory {agent}`); prune what it does.
- Serve `benchmark/fixtures/northmoor` (after `render-large-page.js` and `render-minutes.js`) as
  [`driving.md`](references/driving.md) describes, and verify a fetch from inside the app container.
- `node scripts/driver.mjs login`.

Done when `server-changes.md` lists every change made so far and the container fetches a fixture page.

## 2. Drive

Round 1 is `tasks/round-1.json` (twelve probes with fixed answers); round 2 is `tasks/round-2.json`
(realistic tasks, one of them two turns apart). Every task runs on every test agent at once:

```sh
node scripts/driver.mjs task p01          # posts to every agent, decides prompts, waits, saves traces, writes run.json
node scripts/driver.mjs resume p02 ds:<humanPostId>,glm:<humanPostId>   # re-attach after a driver failure
node scripts/driver.mjs cmd glm "/collegium steer Stop fetching and write up what you have."
```

The policy, in the driver and not to be relaxed by hand: every gated call approved within a poll;
a scripted `deny-with-reason` only where the task says; an unscripted `extend_budget` denied with a
reason (a loop is the finding, not something to fund); a turn waited ten minutes for a terminal
marker and then recorded as it stands. Write a line per task into `round-N-notes.md` as you go:
the outcome, the calls, anything you had to do.

Done when `run.json` has an entry for every task and agent with a terminal outcome or a note.

## 3. Extract

```sh
ssh <host> 'docker exec -i <container> node - <channelId,…> <agent,…>' < scripts/extract-store.js > raw/round-N.json
node scripts/slice.mjs --raw raw/round-N.json --run run.json --out artifacts --tasks <ids>
```

Done when `artifacts/<task>/<agent>/summary.json` exists for every entry in `run.json`.

## 4. Read

One reader per task and agent (the Agent tool, `model: "opus"`, in parallel), each given
[`references/reader.md`](references/reader.md), the task file, the artifact directory, and that
agent's own `/collegium inspect` output. Each writes `records/<task>-<agent>.json`. A record whose
`quality` is `insufficient` is re-dispatched once with its stated gap.

Done when every record carries a verdict and a quoted line for every check.

## 5. Review

Four Opus reviewers in parallel, writing under `review/`: framework findings verified against the
code and SPEC; tool findings verified the same way; a prompt redraft (preamble sentences must stay
runtime facts, SPEC §3.8); and an adversarial audit of the records (disputed verdicts, wrong
causes, quotes that are not in the artifacts). [`references/report.md`](references/report.md)
holds their briefs.

Done when each review states a verdict per claim with file:line citations, and the audit lists
every dispute with its evidence.

## 6. Report

`node scripts/aggregate.mjs records <prefix>` per round, then `report.md` in the run directory as
[`references/report.md`](references/report.md) lays out: recommendations first, the deep dive for
an implementer second, the audit's corrections already applied. Every claim names the runs it
rests on.

Done when the recommendations list is complete and each finding in the deep dive points at the
review that verified it.

## 7. Revert

Walk `server-changes.md` from the bottom up, run each revert, and record the verification beside
its entry (config checksum, service status, a fetch that now fails). Leave the channels, memories
and workspaces as the run left them, and say so in the log.

Done when every entry in `server-changes.md` has its verification and the app is healthy on the
pre-run config.
