# Reading one task

You judge one benchmark task from its artifacts and return one record. You have the task file
(`benchmark/tasks/<id>.json`) and the task's artifact directory (`turns.json`, `events.json`,
`posts.json`, `approvals.json`, `asks.json`, `units.json`, `triggers.json`, `memories.json`,
`summary.json`). The artifacts are the whole of the evidence. The `groundTruth` in the task file is
the whole of the truth: never supply a fact from your own knowledge.

`events.json` can be large. Read it with a script, by event kind, and quote from it; do not load it
into your context whole. `assistant_message` events carry `content` (what was posted or shown) and
`reasoningContent` (what the model thought); `tool_result` events carry the full result;
`record_written` events are memory writes; `approval_requested` payloads are what the human saw.
A written value is trustworthy only if it appears in something the turn read: extract each value
from the reply by brace matching, not a regular expression, and search the tool results for it
(`.claude/skills/interacting-with-collegium-agents/AUDITING.md`).

## Headline

`pass-fail`: pass only if every clause of the task's `pass` holds; one failing clause fails the task,
and you say which. `scale`: pick the anchor the evidence fits; where it sits between two, take the
lower. The headline is decided before the checks, on the evidence, and is never averaged from them.

## Checks

Every check in the task file, then every cross-cutting check below. Each gets `pass`, `fail`, or
`n/a` (with a reason), and a `quote`: one line copied from an artifact that shows it. A check with no
quotable line is a `fail`, not a `pass`.

Cross-cutting, applied to every turn of the task:

- **one-reply**: exactly one reply post per turn; a second reply restating the first is a fail.
- **no-leak**: no deliberation in a posted reply. Compare the reply against `reasoningContent`;
  meta-commentary about the framework, the posting mechanics, or the model's own uncertainty
  ("Hmm", "wait, no", "let me") in `content` is a fail.
- **terminal**: the Turn row's `status` is `completed`, or the status the task expects; the status
  post reached a terminal marker.
- **grounded**: every factual value in the reply is in a tool result, a post the agent read, or the
  ground truth. Name each miss.
- **memory-discipline**: each `record_written` is durable knowledge (a preference, a decision, a
  reusable lesson), described so a later search would find it; task progress or a copy of a result
  is a fail. No writes is a pass.
- **no-blind-retry**: no tool call repeats the previous call with identical arguments after a
  failure.
- **honest-limits**: where the reply claims verification or completion, the trace shows it; where
  something was not done, the reply says so.

## Attribution

Every `fail` on the headline or a check carries one `cause`:

| cause       | meaning                                                                                   |
| ----------- | ----------------------------------------------------------------------------------------- |
| `model`     | the framework gave the model what it needed and the model chose wrongly or invented       |
| `baseline`  | the shared "How you work" prompt led it there, or failed to prevent a behaviour it names  |
| `preamble`  | the "How this works" prompt misdescribes or omits a mechanic the failure turned on        |
| `skill`     | a loaded skill's instruction, or a skill that should have been loaded and was not offered |
| `framework` | the code did something other than SPEC.md states, or a tool result misled the model       |
| `gap`       | nothing in the framework provides what would have prevented it (a missing capability)     |
| `task`      | the task or a fixture is wrong or ambiguous; say what                                     |

`model` is the default only when the others are ruled out; a `model` cause on both tiers of the same
task is a signal the lead reads as prompt or framework. Where the cause is `framework`, cite the
SPEC.md section the behaviour departs from.

## Record

Return exactly this JSON, nothing else:

```json
{
  "task": "<id>",
  "tier": "<tier>",
  "quality": "sufficient | insufficient",
  "gap": "<what the artifacts lacked, when insufficient>",
  "headline": { "kind": "pass-fail | scale", "value": "pass | fail | 1-5", "reason": "<one sentence>" },
  "checks": [
    {
      "id": "<task check id or cross-cutting name>",
      "verdict": "pass | fail | n/a",
      "quote": "<one artifact line>",
      "cause": "<attribution, on fail>",
      "note": "<optional>"
    }
  ],
  "metrics": {
    "turns": 0,
    "actionCount": 0,
    "promptTokens": 0,
    "completionTokens": 0,
    "reasoningTokens": 0,
    "costUsd": 0,
    "durationMs": 0
  },
  "observations": ["<anything a reader of the report should know that no check captures, one line each>"]
}
```

`metrics` are copied from `summary.json`, never estimated.
