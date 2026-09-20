# The run report

`report.md` in the run directory, built from the records. Every number comes from a record or
`summary.json`; every finding names its tasks. Sections in this order, headings as written.

## Run

Version, commit, date, tiers, wall time of the drive, total cost per tier, tasks driven, skipped and
stalled. One paragraph on anything that makes this run not comparable to the last (a task changed,
a fixture changed, a stall).

## Headline

One row per task in `order.json`, per tier, in order:

| task | title | tier | headline | value | calls | tokens (prompt / completion / reasoning) | cost | duration |

Then the totals: pass-fail tasks passed over pass-fail tasks driven, the mean of the scale tasks, per
tier. Where two tiers ran, a third column set gives the difference.

## Comparison

Against the most recent earlier run directory, where one exists: the same headline table showing
this run and the earlier one side by side, with a final column naming what changed (`same`,
`improved`, `regressed`, `new`, `gone`). Absent an earlier run, the section says so in one line.

## Failures

Every headline fail and every failed check, grouped by attribution class in the order `framework`,
`preamble`, `baseline`, `skill`, `task`, `model`. Each entry: task, check, the reader's quote, the
reader's reason. A `framework` entry carries its SPEC.md citation.

## Findings

Ranked by how many tasks each rests on and how severe the behaviour is. Each finding is one paragraph:
the behaviour, the tasks and tiers it appeared in, the attribution, and what would change it (a
prompt sentence, a skill, a code path, a task fix), stated as a proposal for a person to decide.
Where the two tiers disagree, say so: that is the attribution evidence.

## Observations

The readers' observations that no check captured, deduplicated, each with its task.
