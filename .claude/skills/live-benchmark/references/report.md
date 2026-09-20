# The reviews and the report

## Reviewer briefs

Each reviewer is an Opus agent with the run directory, the repo, and one output file under
`review/`. It never modifies anything else.

- **Framework verification.** Scope: every finding attributed to `framework` or `design`. For each
  claim: CONFIRMED, PARTLY (what differs) or REFUTED, with file:line and a quoted line; what the
  reader got wrong; a proposed change specific enough to implement (files, functions, the new
  behaviour, the SPEC section to amend, the test to add).
- **Tool verification.** Same form for every finding attributed to `tool`: the exact result text a
  model received, where it is produced, the new wording verbatim.
- **Prompt redraft.** Given SPEC §3.8, `system-prompt.renderer.ts`, the rendered prompt an agent
  saw and the `preamble`/`baseline` items: a diff-style list (current sentence → proposed, with
  line numbers). Constraints: every preamble sentence stays a runtime fact in Simplified Technical
  English with deployment values substituted; instructions live in the baseline; nothing per-turn
  or model-specific. It also lists every current preamble sentence that is not a runtime fact.
- **Record audit.** Adversarial: for every record, does the headline follow from the pass clause
  and the quoted evidence; sample the causes against the brief's table; find inconsistencies
  between readers of the same task; spot-check quotes against the artifacts; list what in the
  lead's synthesis the records do not support. Output: a table of disputed verdicts with evidence.

## The report

`report.md` in the run directory. It is written for two readers at once: the person deciding what
to do, who reads the top, and the agent implementing it, who reads the rest.

1. **Executive summary.** Three or four paragraphs: what dominated, what else was found, what
   worked; then **Recommendations** as one numbered list in priority order, each one line naming
   the finding it rests on and the files it touches.
2. **The run.** A table: instance, repo state and image, agents and models, channels, fixtures,
   driving policy, evidence route, judging, cost, wall time. Incidents in one paragraph.
3. **Headline tables.** One row per task per round with the verdict per model after the audit's
   corrections, calls per model, and footnotes for anything a pass hides.
4. **Deep dive.** One section per finding: evidence (runs, counts, quotes), mechanism (the
   verification's file:line), change (pointing into the review that holds the detail). Cause
   labels: `design` for behaviour SPEC specifies that the run shows to be wrong, `framework` for
   code departing from SPEC, then `preamble`, `baseline`, `tool`, `skill`, `task`, `model`.
5. **Model-attributed, lower weight.** What the models did wrong on their own, in one paragraph.
6. **What to read next.** The notes, digests, reviews, records, tasks and scripts by name.
7. **Caveats.** Single runs, driver artefacts, encrypted reasoning, anything amended after the run.

Numbers in the report come from `summary.json`, `run.json` and `/collegium usage`, never from
memory; where the audit corrected a count, the corrected count appears and the audit is cited.
