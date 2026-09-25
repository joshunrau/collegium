import type { z } from 'zod';

import { renderDenialLine } from '@/approvals/approvals.renderer.ts';

import type { TraceMark } from './tools.types.ts';

const SIZE_FORMAT = new Intl.NumberFormat('en-US');

/**
 * §7.2 — a size refusal states the size it received, so a model that resends a refused payload
 * learns by how much to cut it: zod's own "expected string to have <=2000 characters" names only
 * the limit. Only a string's or an array's length is restated; every other issue keeps zod's text.
 */
export function renderSizeIssue(issue: z.core.$ZodRawIssue): string | undefined {
  if (issue.code !== 'too_big' && issue.code !== 'too_small') {
    return undefined;
  }
  const { input } = issue;
  if (!(typeof input === 'string' || Array.isArray(input)) || (issue.origin !== 'string' && issue.origin !== 'array')) {
    return undefined;
  }
  const unit = issue.origin === 'string' ? 'characters' : 'items';
  const received = `${SIZE_FORMAT.format(input.length)} ${unit}`;
  const bound = Number(issue.code === 'too_big' ? issue.maximum : issue.minimum);
  if (issue.exact === true) {
    return `Wrong length: ${received} where exactly ${SIZE_FORMAT.format(bound)} are required`;
  }
  if (issue.code === 'too_big') {
    const allowed = issue.inclusive === false ? bound - 1 : bound;
    const label = issue.origin === 'string' ? 'Too long' : 'Too many';
    return `${label}: ${received}, ${SIZE_FORMAT.format(input.length - allowed)} over the ${SIZE_FORMAT.format(allowed)} allowed`;
  }
  const required = issue.inclusive === false ? bound + 1 : bound;
  const label = issue.origin === 'string' ? 'Too short' : 'Too few';
  return `${label}: ${received}, ${SIZE_FORMAT.format(required - input.length)} under the ${SIZE_FORMAT.format(required)} required`;
}

/** §7.2 — the one line a call that ran carries for the arguments its tool does not declare, ahead of everything a view may cut */
export function renderIgnoredArgumentsLine(keys: readonly string[]): string {
  return `ignored: ${keys.join(', ')}, not ${keys.length === 1 ? 'a parameter' : 'parameters'} of this tool`;
}

/** §8.1 — a denied call's line says who denied it, whether the turn went on or stopped there (§5.4) */
export function renderDenialTraceMark(byUsername: string): TraceMark {
  return { ran: false, text: `🛑 denied by @${byUsername}` };
}

/**
 * §5.4 — a reasoned denial is a person's decision the turn continues under, and reads as one rather
 * than as a tool error: told only `denied: <reason>`, one model reported the tool as broken and
 * another ended its turn believing it needed fresh permission.
 */
export function renderToolDenialResult(input: { byUsername: string; displayName: string; reason: string }): string {
  return [
    renderDenialLine({ byUsername: input.byUsername, reason: input.reason, subject: input.displayName }),
    '',
    "This is a person's decision, not a tool error. The turn continues under the same budget: you may act on the reason, including by making this call differently, or reply."
  ].join('\n');
}

/** §3.7a — an answer is a person's words, named as such, so the model does not read it as a tool's */
export function renderAskAnswerResult(input: { answerText: string; byUsername: string }): string {
  return `${input.byUsername} answered: ${input.answerText}`;
}
