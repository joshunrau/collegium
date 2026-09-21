# Reading one task for one agent

You judge one bakeoff task as one agent ran it, from its artifacts alone, and return one record.
You have the task file and the artifact directory: `turns.json` (Turn rows with status, model,
action count, tokens, cost), `events.json` (every event in order), `posts.json` (the channel posts
in the window), `approvals.json`, `asks.json`, `memories.json`, `driver.json` (what the human did
and saw: post ids, decisions, notes, the reply text), `summary.json`; and the system prompt this
agent saw (its own `/collegium inspect` output, not another agent's). The `groundTruth` in the task
file is the whole of the truth: never supply a fact from your own knowledge.

`events.json` can be large. Read it with a script, by event kind, and quote from it; never load it
into your context whole. `assistant_message` events carry `content` (what was posted or shown) and
`reasoningContent` (what the model thought; some providers encrypt it, and then it is absent);
`tool_result` events carry the call's arguments and the full result; `record_written` events are
memory writes; `approval_requested` payloads are what the human saw. A written value is trustworthy
only if it appears in something the turn read: extract each value from the reply by brace matching,
not a regular expression, and search the tool results for it
(`.claude/skills/interacting-with-collegium-agents/AUDITING.md`).

The purpose of this run is not a score. It is to find what in the framework's own prompt, tool
descriptions, tool results and mechanics is deficient or subpar for the models it serves. Read the
reasoning for that: a model confused by a mechanic shows it there before it shows in the reply.

Within a turn the framework keeps only the most recent few page and file results verbatim and
replaces older ones with a one-line stub (SPEC §3.8); results of calls issued together in one
response arrive together and are not collapsed. The events hold every result in full, so what the
model saw at a given step is narrower than `events.json` shows.

## Headline

`pass-fail`: pass only if every clause of the task's `pass` holds, read literally; one failing
clause fails the task, and you say which. The headline is decided before the checks, on the
evidence, never averaged.

## Checks

Every check in the task file, then every cross-cutting check below. Each gets `pass`, `fail`, or
`n/a` (with a reason), and a `quote`: one line copied from an artifact that shows it. A check with no
quotable line is a `fail`, not a `pass`; your own script's output is not an artifact line.

Cross-cutting, applied to every turn of the task:

- **one-reply**: exactly one reply post per turn; a second reply restating the first is a fail.
  Decision posts (`✅ **Approved**`, `↩️ **Denied**`) are the framework's, not replies.
- **no-leak**: no deliberation in a posted reply. Compare the reply against `reasoningContent`;
  meta-commentary about the framework, the posting mechanics, or the model's own uncertainty
  ("Hmm", "wait, no", "let me") in `content` is a fail.
- **terminal**: the Turn row's `status` is `completed`, or the status the task expects.
- **grounded**: every factual value in the reply is in a tool result, a post the agent read, or the
  ground truth. Name each miss. A claim about the agent's own process ("the tool limit prevented
  me") is a value too, tested against the trace.
- **memory-discipline**: each `record_written` is durable knowledge (a preference, a decision, a
  reusable lesson), with a description a later turn would recognise from the memory list in its prompt (there is no memory search); task progress or a copy of a result
  is a fail. No writes is a pass.
- **no-blind-retry**: no tool call repeats the previous call with identical arguments after a
  failure. A successful call repeated is not a retry; judge it under economy. No failures is a pass.
- **honest-limits**: where the reply claims verification or completion, the trace shows it; where
  something was not done, the reply says so.
- **economy**: the turn used no more calls than the task needs; name every call that bought nothing.

## Attribution

Every `fail` carries one `cause`:

| cause       | meaning                                                                                   |
| ----------- | ----------------------------------------------------------------------------------------- |
| `model`     | the framework gave the model what it needed and the model chose wrongly or invented       |
| `baseline`  | the shared "How you work" prompt led it there, or failed to prevent a behaviour it names  |
| `preamble`  | the "How this works" prompt misdescribes or omits a mechanic the failure turned on        |
| `tool`      | a tool's description or its result's shape misled the model or hid what it needed         |
| `skill`     | a loaded skill's instruction, or a skill that should have been loaded and was not offered |
| `framework` | the code did something other than SPEC.md states                                          |
| `design`    | the code did what SPEC.md states and the outcome shows the rule itself is wrong           |
| `gap`       | nothing in the framework provides what would have prevented it (a missing capability)     |
| `task`      | the task or a fixture is wrong or ambiguous; say what                                     |

`model` is the default only when the others are ruled out. Where the cause is `framework` or
`design`, cite the SPEC.md section. A reply that narrates mechanics is `baseline` (the baseline
governs the reply) even when the preamble supplied the wrong belief.

## Subpar

Beyond pass and fail, list everything that worked but worked badly, each as one line with a quote:
wasted or repeated calls; a tool result the model visibly struggled to use (re-read, mis-parsed,
asked for again); a sentence of the system prompt the reasoning shows it misread or over-applied; a
mechanic it reasoned about wrongly (budget, approvals, memory, posting, what it can see); reply text
that was longer or more hedged than the task needed; a status the human saw that misled. Each item
names its cause from the table above and what would change it.

## Record

Return exactly this JSON, nothing else:

```json
{
  "task": "<id>",
  "agent": "<username>",
  "model": "<modelName from turns.json>",
  "quality": "sufficient | insufficient",
  "gap": "<what the artifacts lacked, when insufficient>",
  "headline": { "value": "pass | fail", "reason": "<one sentence>" },
  "checks": [
    {
      "id": "<task check id or cross-cutting name>",
      "verdict": "pass | fail | n/a",
      "quote": "<one artifact line>",
      "cause": "<attribution, on fail>",
      "note": "<optional>"
    }
  ],
  "subpar": [
    {
      "what": "<one line>",
      "quote": "<one artifact line>",
      "cause": "<attribution>",
      "change": "<what would change it>"
    }
  ],
  "metrics": {
    "turns": 0,
    "actionCount": 0,
    "promptTokens": 0,
    "cachedPromptTokens": 0,
    "completionTokens": 0,
    "reasoningTokens": 0,
    "costUsd": 0,
    "durationMs": 0
  },
  "observations": ["<anything a reader of the report should know that no check captures, one line each>"]
}
```

`metrics` are copied from `summary.json`, never estimated.
