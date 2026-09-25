---
name: reviewing-run-extracts
description: Reviewing a Collegium run extract for defects and fixes. Use to analyse a live run's posts and traces, verify findings, or turn them into a change plan.
---

Turns a run extract into verified findings and one consistent change plan, with subagent workflows. It is built for extracts larger than one context. If preparation yields one slice, one reader suffices.

Terms:
- The *owner* is the person who decides what ships.
- The *previous tag* is the tag of the last reviewed run, or else the release before the build that ran.
- An *earlier review* is a past review of an earlier run. Ask the owner where it and its extract are.

## Ground rules

- Any notes written alongside the extract, such as a README, are claims to test, not facts. In two consecutive
  reviews, a README written alongside the run got central points wrong.
- Attribute to the build that ran. The extract doesn't record its version, so get it from the deployment (its image
  tag) or from the owner. Read code at that tag (`git show <tag>:<path>`), and diff against the previous tag to find
  what changed.
- Read every turn. A curated extract hides the tail. In one review, a tool appeared only in its bounded form in the
  curated sample, and its unbounded form later caused most of a run's `context_exhausted` turns.
- Earlier review decisions and the owner's rulings are information with their reasoning, never authority. Skeptics,
  arbiters and critics attack them freely. In one review, regression skeptics told that earlier decisions were "agreed
  direction" rejected 1 fix in 30. Without that framing, they rejected 10 in 62.
- Privacy: extracts can hold real people's names and contact details. They never go into code, tests, commits or PRs.

## Steps

1. **Prepare.**
   - Work from an extract of every turn. If it is curated, re-run `scripts/export-turns.js inventory` and then
     `export --manifest <path> --all`, or ask the owner to.
   - Run `python3 .agents/skills/reviewing-run-extracts/scripts/prepare.py <extract-dir> --timezone <IANA zone>`,
     using the operator's zone, so times match the traces. The script writes three things:
     - condensed traces, with tool results cut to 700 characters and the full size noted;
     - per-channel timelines, with each status post annotated by its turn;
     - reader slices sized by `--slice-chars` (default: 700k characters of reading).

   **Done when** the slices in `slices.json` sum to every turn in `exported.jsonl`.
2. **Find.**
   - One reader per slice reads every turn, and opens the full trace wherever a cut result matters.
   - Cross-cutting lenses each search every channel:
     - one per framework subsystem the run exercised, such as context limits, activation and hand-offs, work units,
       restarts, refusals, memory, web and the prompt;
     - one for metrics against the earlier review's extract, where there is one;
     - one per plugin the run used, covering its tools, then its skills and config;
     - one for the operator surface;
     - commit-by-commit regression hunts over the diff since the previous tag.
   - Each finding carries:
     - an id;
     - title and area;
     - origin: a regression, an earlier fix left incomplete, or new;
     - commit, and the ids of related findings from the earlier review;
     - mechanism, and evidence refs (channel plus post or turn id);
     - counted scale, harm and recommendation;
     - severity. High breaks a workflow or loses work or data. Medium is a real, recurring cost. Low is a small cost
       or polish.
3. **Merge.** One sorting agent buckets all findings by subsystem from one-line summaries. Then one agent per bucket
   merges them by root cause. **Done when** every finding id is in exactly one bucket.
4. **Verify each finding, in sequence.**
   1. A reality skeptic tries to refute it. It re-opens the full traces, recounts, checks the mechanism at the build's
      tag, and confirms attribution with `git show` against the previous tag. If the evidence can't be found, it
      defaults to refuted.
   2. An arbiter runs only when the finding is refuted.
   3. A regression skeptic checks the recommended fix against the corrected finding: callers, tests, SPEC, the other
      changes, and deployments beyond the one that ran. It rejects fixes tuned to one instance.
   4. An arbiter runs only when the fix is judged unsafe or not warranted.
5. **Aggregate.** Changes checked one at a time collide. In one review, most regressions came from earlier changes
   that had each been verified alone.
   1. Where an earlier review's changes shipped, run a post-mortem of each one: keep, amend or revert.
   2. Synthesise one change set, built on stated invariants.
   3. Run critics for consistency, generality and overengineering, earlier decisions, and interactions. The
      interactions critic walks concrete workflows through the combined changes.
   4. Revise, accepting or rejecting every critique with a reason.
   5. Re-check for consistency.
6. **Decide, then plan.**
   - Take the owner's decisions one at a time, each with brief context, options, pros and cons, and a recommendation.
   - Draft the whole implementation plan, then review it as a whole. Use the step 5 critics, plus feasibility against
     the code, evidence and proportion, and a fresh-eyes critic that reads only the plan, SPEC and code.
   - A reviser may overturn a ruling only on very solid logic, and logs how to restore it. Doubtful overturns go to
     the owner.

## Running it

Must do:

- **Checkpoints.** Every agent appends its progress to its own file after each major step, and its final result
  before returning. On start, it reads that file if it exists and continues from there. A stopped run then loses
  minutes, not hours.
- **State in files, ids in prompts.** Write each finding and its verdicts to a file named by its finding id. Prompts
  name the file, and workflow arguments carry only ids.
- **Split into parallel workflows.** The workflow tool caps how many agents run at once in each workflow, and agents
  wait on the API, not the CPU. In one review, three verification workflows ran about three times as fast as one.
- **Keep prompts stable.** A resume replays only agents whose prompt is unchanged, and changing a shared preamble
  invalidates all of them. Put new framing into agents that haven't run yet, for example in a new script over the
  remaining ids.
- **At a usage limit, stop every run at once.** A stuck agent later gives up with an empty result, which a resume
  replays as done. To pause, stop the run too: a workflow can't drain, because a freed slot refills immediately.

Cut to save tokens:

- **A completeness critic,** one that hunts for findings the readers missed, once readers cover every turn. In one
  review, it proposed 2 findings and kept 1 of low value, for about 1M tokens.
- **Asking skeptics to record every correction.** Ask for material corrections only: severity, origin, attribution
  and scale. In one review, the exhaustive form averaged about 4k characters per check.
- **Re-running finished checks after a framing change.** The aggregate critics cover them.
- **A long report.** Lead with the decisions and the change set, and give each finding a few lines of evidence.
- **Unmerged findings.** Verification dominates the cost (about 120k tokens per check in one review), so merge
  hard before verifying.

## What the recommendations need

- A threshold or limit change is untested until it has been replayed over the run's own traces, including what the
  newly reachable path does next.
- Wording fails wherever a rule or competing instruction forces the behaviour, so change the mechanism instead.
- Put required steps in tool contracts, where they happen whether or not a skill is loaded. In one run, the
  supervisor loaded its skill in 3 of 236 turns.
- Each change names what the next run's export should show if it works.
