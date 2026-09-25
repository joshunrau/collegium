import { createHash } from 'node:crypto';

import type { ToolReadOn } from '@collegium/core/tools';
import { CHARS_PER_TOKEN } from '@collegium/core/utils';

import type { AgentProfile } from '@/agents/agents.types.ts';

import {
  RELIEF_LOW_WATER_SHARE,
  RESULT_MIN_TOKENS,
  RESULT_VIEW_MAX_TOKENS,
  RESULT_VIEW_SHARE
} from './retention.constants.ts';

const CHARACTER_FORMAT = new Intl.NumberFormat('en-US');

/** a read result relief may replace with its line: how much doing so frees, and its message's place, which orders ties oldest first */
export type ReliefCandidate = {
  readonly key: number;
  readonly savedTokens: number;
};

/** a result just received, by its message's place, and how much of it its view shows now */
export type ViewCandidate = {
  readonly key: number;
  readonly shownChars: number;
};

export type ViewPlan = {
  /** the views to shorten, and to how many characters */
  readonly shownChars: ReadonlyMap<number, number>;
  /** the results that cannot keep even the floor, which show only their size and reference */
  readonly standIns: readonly number[];
};

/** §3.8 — the widest view any one result gets in this agent's turns, in characters */
export function viewCapCharsFor(profile: Pick<AgentProfile, 'turnContextCeilingTokens'>): number {
  const tokens = Math.min(Math.floor(profile.turnContextCeilingTokens * RESULT_VIEW_SHARE), RESULT_VIEW_MAX_TOKENS);
  return tokens * CHARS_PER_TOKEN;
}

/** §3.8 — the least a view is shortened to under pressure, in characters */
export function viewFloorChars(): number {
  return RESULT_MIN_TOKENS * CHARS_PER_TOKEN;
}

/** §3.8 — the identity of a result's text, so a byte-identical repeat is recognised as one */
export function hashResult(output: string): string {
  return createHash('sha256').update(output).digest('hex');
}

/**
 * §3.8 — which read results relief replaces with their lines: none while the prompt is at or under
 * the ceiling; otherwise the ones freeing the most first, ties to the oldest, so the fewest stand-ins
 * do it and the small results carrying the turn's procedure stay, until the prompt is at or under the
 * low-water mark or nothing read is left.
 */
export function planRelief(input: {
  readonly candidates: readonly ReliefCandidate[];
  readonly ceilingTokens: number;
  readonly promptTokens: number;
}): number[] {
  if (input.promptTokens <= input.ceilingTokens) {
    return [];
  }
  const target = Math.floor(input.ceilingTokens * RELIEF_LOW_WATER_SHARE);
  const ordered = input.candidates
    .filter(({ savedTokens }) => savedTokens > 0)
    .toSorted((left, right) => right.savedTokens - left.savedTokens || left.key - right.key);
  const chosen: number[] = [];
  let prompt = input.promptTokens;
  for (const candidate of ordered) {
    if (prompt <= target) {
      break;
    }
    chosen.push(candidate.key);
    prompt -= candidate.savedTokens;
  }
  return chosen;
}

/**
 * §3.8 — how the results the latest completion's calls returned are fitted while the prompt is still
 * over the ceiling after relief: their views shorten together, the longest first and none below the
 * floor, by as little as frees the excess. Where even the floors do not fit, the newest shows only its
 * size and reference, then the next newest.
 */
export function planView(input: {
  readonly candidates: readonly ViewCandidate[];
  readonly excessTokens: number;
  readonly floorChars: number;
}): ViewPlan {
  const excessChars = input.excessTokens * CHARS_PER_TOKEN;
  const reducible = input.candidates
    .filter(({ shownChars }) => shownChars > input.floorChars)
    .toSorted((left, right) => right.shownChars - left.shownChars);
  const shownChars = new Map<number, number>();
  let takenAbove = 0;
  for (const [index, candidate] of reducible.entries()) {
    takenAbove += candidate.shownChars;
    const count = index + 1;
    const next = Math.max(reducible[index + 1]?.shownChars ?? input.floorChars, input.floorChars);
    const level = Math.floor((takenAbove - excessChars) / count);
    if (level >= next) {
      for (const lowered of reducible.slice(0, count)) {
        shownChars.set(lowered.key, level);
      }
      return { shownChars, standIns: [] };
    }
  }
  for (const lowered of reducible) {
    shownChars.set(lowered.key, input.floorChars);
  }
  let remaining = excessChars - reducible.reduce((sum, { shownChars: shown }) => sum + shown - input.floorChars, 0);
  const standIns: number[] = [];
  for (const candidate of input.candidates.toSorted((left, right) => right.key - left.key)) {
    if (remaining <= 0) {
      break;
    }
    standIns.push(candidate.key);
    shownChars.delete(candidate.key);
    remaining -= Math.min(candidate.shownChars, input.floorChars);
  }
  return { shownChars, standIns };
}

/**
 * §3.8 — what follows the part of a result a view shows: its whole size, when it was recorded, and
 * how to read on, naming the record a read was taken from rather than the read itself.
 */
export function renderViewLine(input: {
  readonly readOn: ToolReadOn | undefined;
  readonly recordedAt: string;
  readonly ref: string;
  readonly shownChars: number;
  readonly totalChars: number;
}): string {
  const { readOn, recordedAt, ref, shownChars, totalChars } = input;
  const shown = CHARACTER_FORMAT.format(shownChars);
  if (readOn !== undefined) {
    const next = readOn.offset + Math.max(0, shownChars - readOn.textIndex);
    return `\n[this read of result ${readOn.ref} is shown to its first ${shown} characters; read on with results__read ref=${readOn.ref} offset=${next}]`;
  }
  return `\n[result ${ref}, recorded at ${recordedAt}: shown its first ${shown} of ${CHARACTER_FORMAT.format(totalChars)} characters; read the rest with results__read ref=${ref} offset=${shownChars}, or search it with find]`;
}

/**
 * §3.8 — what a read result reads as once relief replaces it. The time lets the model choose between
 * the record and a fresh call where what it read may have changed since.
 */
export function renderCollapsedLine(input: {
  readonly readOn: ToolReadOn | undefined;
  readonly recordedAt: string;
  readonly ref: string;
  readonly subject: string;
}): string {
  const { readOn, recordedAt, ref, subject } = input;
  const again =
    readOn === undefined
      ? `results__read ref=${ref} shows it again as it was then`
      : `results__read ref=${readOn.ref} offset=${readOn.offset} shows it again`;
  return `[${subject}, result ${ref}, recorded at ${recordedAt} — read earlier this turn and no longer shown; ${again}. Copy what you need into your own text rather than reading it twice.]`;
}

/** §3.8 — a result just received that not even the floor of a view fits: its size and its reference, which read it in parts */
export function renderUnreadStandIn(input: { readonly ref: string; readonly subject: string }): string {
  return `[${input.subject}, result ${input.ref} — not shown: this turn's context is nearly full. results__read ref=${input.ref} reads it in parts, or find searches it.]`;
}

/** §3.8 — a repeat of a result still shown costs one line naming it; the same content from another address says so */
export function renderRepeatLine(input: {
  readonly earlierRef: string;
  readonly earlierSubject: string;
  readonly isSameText: boolean;
  readonly ref: string;
}): string {
  const { earlierRef, earlierSubject, isSameText, ref } = input;
  return isSameText
    ? `[result ${ref} — the same text as result ${earlierRef}, which is still shown above]`
    : `[result ${ref} — the same content as result ${earlierRef} (${earlierSubject}), which is still shown above]`;
}

/** §3.8 — what a repeat of a result since replaced opens with, when it is shown again */
export function renderRepeatNote(input: { readonly earlierRef: string; readonly isSameText: boolean }): string {
  return `[the same ${input.isSameText ? 'text' : 'content'} as result ${input.earlierRef}, which you read earlier this turn]`;
}
