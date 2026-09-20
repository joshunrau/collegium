---
name: assessing-collegium
description: Run the Collegium benchmark against a local stack and judge the run. Use to measure a framework change, produce a run report under benchmark/results, or compare two runs.
---

One run: boot a fresh stack from this checkout, drive every task in `benchmark/tasks/` as the
human, extract each task's artifacts from the store, have one reader judge each task from its
artifacts, and write the report. The framework version is the only thing that should differ between
two runs, so nothing here is skipped or reordered. `benchmark/README.md` describes the files.

You are the lead. You drive, dispatch readers, and write the report. You never read a raw
`events.json`: a reader does, and hands you a record.

## 1. Boot

Read `benchmark/roster.json` and `benchmark/tasks/order.json`. Set `BENCH_TIERS` (`reference`
alone until a full reference run has been judged and reviewed; then `reference,control`) and the
provider keys and mailbox `render-config.js` names in its header, then:

```sh
node benchmark/scripts/render-config.js
rm -rf benchmark/stack/state
benchmark/scripts/stack.sh up -d --build
```

Docker commands and the test suites hang inside the Bash sandbox; run them with the sandbox
disabled. Done when `stack.sh logs app` shows the boot notice, the `web.allowPrivateAddresses` warning,
and the `bookmark` plugin loaded, and `curl http://127.0.0.1:8066/api/v4/system/ping` answers.

## 2. Drive

Mechanics are in [`references/driving.md`](references/driving.md). Follow `benchmark/stack/plan.json`
in order, one tier at a time. For each task: add its members and yourself to its channel, run its
`setup`, then play its `steps`, deciding each approval exactly as scripted and waiting for the
terminal status marker and the reply after every post. Record `run.json` as you go.

Done when every task in the plan has an entry in `run.json` with its channel ids, its human post
ids, and either a terminal outcome or a note saying what did not happen and when you stopped waiting.
A task that stalls is recorded and left; you do not nudge, re-mention, or repair. Skipped tasks
(unmet `requires`) are recorded as skipped.

## 3. Extract

```sh
run=benchmark/results/$(date +%F)_$(node -p "require('./package.json').version")_$(git rev-parse --short HEAD)
benchmark/scripts/snapshot-db.sh "$run/prod.db"
node benchmark/scripts/extract.js --db "$run/prod.db" --run "$run/run.json" --out "$run"
benchmark/scripts/stack.sh down
```

Done when `$run/tasks/<id>/summary.json` exists for every driven task.

## 4. Judge

For each task, dispatch one reader (the Agent tool, `model: "sonnet"`) with
[`references/reader.md`](references/reader.md), the task file, and the task's artifact directory.
Run them in parallel. Each returns a record; save it as `$run/tasks/<id>/record.json`. A record with a
`quality` of `insufficient` (the artifacts do not let the reader decide) is re-dispatched once with
the reader's stated gap; if it stays insufficient, the record stands and the report says so.

Done when every driven task has a record whose checks each carry a verdict and a quoted line.

## 5. Report

Write `$run/report.md` from [`references/report.md`](references/report.md). Where an earlier run
exists under `benchmark/results/`, the comparison table is against the most recent one. Every
finding names the tasks it rests on and the attribution class the readers gave it; a finding with no
task behind it does not go in. Commit the run directory.

Done when the report's headline table has one row per task in `order.json`, driven or skipped, and
the findings section is ranked.
