# Benchmark

A controlled, repeatable run of the framework against a local stack, judged by a model from
extracted artifacts. It measures the framework rather than any deployment: the roster is generic,
every seam is held by one narrowly granted agent, and each task has ground truth an assessor holds.
The procedure is the `assessing-collegium` skill under `.claude/skills/`; this directory holds what
it runs on.

```
roster.json          who exists, what each holds, and the two model tiers
tasks/<id>.json      one task: the agent, the human's posts, scripted approvals, the headline metric, checks, ground truth
tasks/order.json     the fixed run order
fixtures/            the Northmoor site nginx serves to the agents as http://fixtures/
stack/               compose.yaml, bench.env, and the rendered config.json and plan.json (both ignored by git)
scripts/             render-config.js, stack.sh, snapshot-db.sh, extract.js, dialog.js, render-large-page.js, render-minutes.js
results/<run>/       one committed directory per run: run.json, prod.db, tasks/<id>/ artifacts and record, report.md
```

## A task file

| Field         | Meaning                                                                                                                                                                                                                                                                                                    |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`, `title` | The task's handle; its channel is `t-<id>` plus the tier suffix, or `t-<id>-<channel>` where `channels` lists several.                                                                                                                                                                                     |
| `agent`       | Who the human addresses. `members` lists everyone added to the channel when more than the agent is needed.                                                                                                                                                                                                 |
| `requires`    | What the run must provide beyond the stack, such as `mailbox`; a task whose requirement is unmet is skipped and reported so.                                                                                                                                                                               |
| `setup`       | Done before the first post: a `mail` sent to the bench mailbox, or a `trigger` posted to the app's trigger route.                                                                                                                                                                                          |
| `steps`       | In order: a `post` by the human (with a `channel` where the task spans two), an `approval` to decide when its prompt appears (`repeat` decides every later prompt the same way), an `ask` to answer, or an `await` for a trigger-started turn. `expect: refusal` marks a post the framework should refuse. |
| `headline`    | `pass-fail`, judged against `pass`, or a `scale` with anchors for 5, 3 and 1 (4 and 2 where the anchors need them).                                                                                                                                                                                        |
| `checks`      | Supporting checks, each marked pass or fail with a quoted line of evidence; the cross-cutting checks in the reader brief apply to every task on top of these.                                                                                                                                              |
| `groundTruth` | The facts the judge holds; a reply is compared against these, never against the judge's own knowledge.                                                                                                                                                                                                     |
| `spec`        | The SPEC.md section a task exists to exercise, where one does.                                                                                                                                                                                                                                             |

## Tiers

`roster.json` declares a reference tier on the production default model and a control tier on a
strong model, both with identical grants and prompts. A failure on both implicates the framework or
its prompt; a failure on the reference tier alone implicates the model. `BENCH_TIERS` selects which
are rendered; the control tier is enabled only once a full reference run has been judged and reviewed.
