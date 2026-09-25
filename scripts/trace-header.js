/// <reference types="node" />

// @ts-check

/**
 * Reads the head of a `/collegium trace` answer, and the figures each completion's event line
 * carries, into the fields `export-turns.js` writes on a row. Kept apart from the exporter, whose
 * modes call a live deployment, so the parsing is tested on its own.
 */

/**
 * What the head of a `/collegium trace` answer says of the turn: its first line, then the record
 * beneath it (§8.3). A record field is undefined where the trace does not state it — a turn recorded
 * before the framework kept it, a running turn's actions, usage a provider never reported.
 *
 * @typedef {object} TraceHeader
 * @property {number | undefined} actionCount
 * @property {string | undefined} activation what started the turn, as the framework names it
 * @property {string} agent
 * @property {number | undefined} cachedPromptTokens the prompt tokens the provider's cache served
 * @property {number} chain
 * @property {TraceCompletion[] | undefined} completions each completion its event line states the
 *   figures of (§8.3), in order; undefined on a trace from before events carried them
 * @property {number | undefined} completionTokens
 * @property {number | undefined} costUsd
 * @property {number} depth
 * @property {string | undefined} drainedFromPostId the earliest queued post a drain began from
 * @property {string} model
 * @property {string} outcome
 * @property {number | undefined} promptTokens
 * @property {number | undefined} reasoningTokens
 * @property {string | undefined} startedAt ISO 8601; undefined where the trace's Started date does not
 *   parse
 * @property {number | undefined} turnDurationMs how long the turn ran, or has run so far
 * @property {string} turnId
 * @property {number | undefined} windowEstimatedTokens what the window the turn last read cost
 */

/**
 * One completion as its event line states it (§8.3). An estimated one is a completion the framework
 * cut short, which the provider never reported: it carries only what it had streamed, and no total
 * includes it.
 *
 * @typedef {object} TraceCompletion
 * @property {true} [afterRelief] a relief pass had edited the prompt since the completion before it
 * @property {number | undefined} [cachedPromptTokens]
 * @property {number | undefined} [completionTokens] reasoning included, as the provider counts it
 * @property {number | undefined} [costUsd]
 * @property {true} [estimated]
 * @property {number | undefined} [promptTokens]
 * @property {number | undefined} [reasoningTokens]
 * @property {string} [servedBy] the upstream the provider routed the completion to
 */

/**
 * The parenthesised duration of a terminal status marker, as in `✅ _done (6m 12s)_`. The post's
 * own timestamps do not measure the turn — it is created after the turn starts and its last edit is
 * not the turn's end — so this is the only honest source for how long a turn ran.
 */
const REPORTED_DURATION_PATTERN = /\((?:(?<hours>\d+)h\s*)?(?:(?<minutes>\d+)m\s*)?(?:(?<seconds>\d+)s)?\)/;

/**
 * `Trace for turn {id} ({agent} on {model}, {outcome}, depth {n}, chain {n}):`, or, for a turn that
 * recorded no events, `Turn {id} (…) recorded no events: …`
 */
const TRACE_HEADER_PATTERN =
  /^(?:Trace for turn|Turn) (?<turnId>\S+) \((?<agent>\S+) on (?<model>[^,]+), (?<outcome>[^,]+), depth (?<depth>\d+), chain (?<chain>\d+)\)/;

/**
 * `Started: {date}, by {activation} ({what that is})…, drained from post \`{id}\`.` — the activation is
 * absent on a turn recorded before the framework kept it
 */
const TRACE_STARTED_PATTERN =
  /^Started: (?<date>.*?)(?:, by (?<activation>[a-z]+) \([^)]*\))?(?:, answering post `[^`]+`)?(?:, drained from post `(?<drained>[^`]+)`)?\.$/m;

/** `Ran: {duration}, {n} actions.`, `Ran: {duration}, until the process restarted.`, or `Running: {duration} so far.` */
const TRACE_RAN_PATTERN = /^(?:Ran|Running): (?<duration>(?:\d+m )?\d+s)(?:, (?<actions>[\d,]+) actions?\.)?/m;

/** `Context: assembled at +{offset}, a window of about {n} tokens reaching back to {date}.`, or an empty window */
const TRACE_WINDOW_PATTERN = /^Context: .*? a window of about (?<tokens>[\d,]+) tokens/m;

/** `Usage: {n} prompt tokens ({n} cached), {n} completion ({n} reasoning); cost ${usd}.`, each parenthesis and the cost optional */
const TRACE_USAGE_PATTERN =
  /^Usage: (?<prompt>[\d,]+) prompt tokens(?: \((?<cached>[\d,]+) cached\))?, (?<completion>[\d,]+) completion(?: \((?<reasoning>[\d,]+) reasoning\))?(?:; cost \$(?<cost>[\d.,]+))?\./m;

/**
 * `⟦completion: {figures}⟧` closing a completion's event line — `{n} prompt ({n} cached)`, `{n} out ({n}
 * reasoning)`, `${usd}`, `via {upstream}`, `after relief`, or `about {n} out ({n} reasoning)` then
 * `estimated` — each part present only where the event records it
 */
const TRACE_COMPLETION_PATTERN = /⟦completion: (?<figures>[^⟧]*)⟧$/gm;

/** a trace's event line, `{n}. [+{offset}] …`, for a model completion that called tools */
export const TRACE_TOOL_CALL_PATTERN = /^\d+\. \[\+[^\]]+\] called `/m;

/**
 * @param {string | undefined} text a count as the trace writes it, grouped with commas
 * @returns {number | undefined}
 */
function readCount(text) {
  return text === undefined ? undefined : Number(text.replaceAll(',', ''));
}

/**
 * @param {string} message
 * @returns {number | undefined} milliseconds, or undefined where no duration is reported
 */
export function readReportedDuration(message) {
  const groups = REPORTED_DURATION_PATTERN.exec(message.split('\n')[0])?.groups;
  if (groups === undefined) {
    return undefined;
  }
  const { hours, minutes, seconds } = groups;
  if (hours === undefined && minutes === undefined && seconds === undefined) {
    return undefined;
  }
  return ((Number(hours ?? 0) * 60 + Number(minutes ?? 0)) * 60 + Number(seconds ?? 0)) * 1000;
}

/**
 * @param {string | undefined} date the Started line's date, as the operator's formatter wrote it
 * @returns {string | undefined}
 */
function readStartedAt(date) {
  if (date === undefined) {
    return undefined;
  }
  const parsed = Date.parse(date.replace(' at ', ' '));
  return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString();
}

/**
 * @param {string} figures the text between `⟦completion: ` and `⟧`
 * @returns {TraceCompletion}
 */
function readCompletion(figures) {
  /** @type {TraceCompletion} */
  const completion = {};
  for (const part of figures.split(', ')) {
    const estimated = /^about (?<out>[\d,]+) out \((?<reasoning>[\d,]+) reasoning\)$/.exec(part)?.groups;
    const prompt = /^(?<prompt>[\d,]+) prompt(?: \((?<cached>[\d,]+) cached\))?$/.exec(part)?.groups;
    const out = /^(?<out>[\d,]+) out(?: \((?<reasoning>[\d,]+) reasoning\))?$/.exec(part)?.groups;
    if (estimated !== undefined) {
      completion.completionTokens = readCount(estimated.out);
      completion.reasoningTokens = readCount(estimated.reasoning);
    } else if (prompt !== undefined) {
      completion.promptTokens = readCount(prompt.prompt);
      completion.cachedPromptTokens = readCount(prompt.cached);
    } else if (out !== undefined) {
      completion.completionTokens = readCount(out.out);
      completion.reasoningTokens = readCount(out.reasoning);
    } else if (part.startsWith('$')) {
      completion.costUsd = readCount(part.slice(1));
    } else if (part.startsWith('via ')) {
      completion.servedBy = part.slice('via '.length);
    } else if (part === 'after relief') {
      completion.afterRelief = true;
    } else if (part === 'estimated') {
      completion.estimated = true;
    }
  }
  return completion;
}

/**
 * @param {string} trace
 * @returns {TraceCompletion[] | undefined}
 */
function readCompletions(trace) {
  const completions = [...trace.matchAll(TRACE_COMPLETION_PATTERN)].map((match) =>
    readCompletion(match.groups?.figures ?? '')
  );
  return completions.length === 0 ? undefined : completions;
}

/**
 * @param {string} trace
 * @returns {TraceHeader | undefined} undefined where the answer names no turn, as it does for a post
 *   no turn in the channel wrote
 */
export function readTraceHeader(trace) {
  const groups =
    /** @type {Record<'agent' | 'chain' | 'depth' | 'model' | 'outcome' | 'turnId', string> | undefined} */ (
      TRACE_HEADER_PATTERN.exec(trace)?.groups
    );
  if (groups === undefined) {
    return undefined;
  }
  const started = TRACE_STARTED_PATTERN.exec(trace)?.groups;
  const ran = TRACE_RAN_PATTERN.exec(trace)?.groups;
  const usage = TRACE_USAGE_PATTERN.exec(trace)?.groups;
  return {
    actionCount: readCount(ran?.actions),
    activation: started?.activation,
    agent: groups.agent,
    cachedPromptTokens: readCount(usage?.cached),
    chain: Number(groups.chain),
    completions: readCompletions(trace),
    completionTokens: readCount(usage?.completion),
    costUsd: readCount(usage?.cost),
    depth: Number(groups.depth),
    drainedFromPostId: started?.drained,
    model: groups.model,
    outcome: groups.outcome,
    promptTokens: readCount(usage?.prompt),
    reasoningTokens: readCount(usage?.reasoning),
    startedAt: readStartedAt(started?.date),
    turnDurationMs: ran === undefined ? undefined : readReportedDuration(`(${ran.duration})`),
    turnId: groups.turnId,
    windowEstimatedTokens: readCount(TRACE_WINDOW_PATTERN.exec(trace)?.groups?.tokens)
  };
}
