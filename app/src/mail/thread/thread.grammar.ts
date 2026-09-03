import type { MailSegmentEnvelope } from './thread.types.ts';

/** a recognised boundary: the envelope it quoted, and the index of the first line after it */
type Boundary = {
  readonly end: number;
  readonly envelope: MailSegmentEnvelope;
};

type MutableEnvelope = { -readonly [Field in keyof MailSegmentEnvelope]?: string };

const QUOTE_PREFIX = /^\s*\\?>\s?/;
const MARKDOWN_LINK = /\[([^\]]*)\]\([^)]*\)/g;
const MARKDOWN_ESCAPE = /\\([\\`*_{}[\]()#+\-.!<>|~])/g;
const WRAPPED_ADDRESS = /^<([^\s<>]+@[^\s<>]+)>$/;

const HEADER_LINE = /^(?:\*\*)?(From|Sent|Date|To|Cc|Subject)\s*:(?:\*\*)?\s*(.*)$/;
const DECORATION =
  /^(?:\\?-{3,}\s*(?:Forwarded message|Original Message)\s*-{3,}|={3,}\s*Forwarded message\s*={3,}|Begin forwarded message:?|-{3,}|\*{3,}|_{3,})$/i;

const ATTRIBUTION = /^-*\s*On\s+(.+?)\s+wrote\s*:?\s*-*$/;
const ATTRIBUTION_OPENING = /^-*\s*On\s+/;
const ATTRIBUTION_CLOSING = /^wrote\s*:?\s*-*$/;
const TIME_TOKEN = /\b\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AaPp]\.?[Mm]\.?)?(?:\s(?:UTC|GMT|[A-Z]{2,4}T|[+-]\d{2}:?\d{2}))?/;

function toParty(value: string): string {
  return WRAPPED_ADDRESS.exec(value)?.[1] ?? value;
}

function toEnvelopeField(label: string): keyof MailSegmentEnvelope | undefined {
  switch (label) {
    case 'Cc':
      return 'cc';
    case 'Date':
    case 'Sent':
      return 'date';
    case 'From':
      return 'from';
    case 'Subject':
      return 'subject';
    case 'To':
      return 'to';
    default:
      return undefined;
  }
}

/** consecutive header lines opened by From, blank lines allowed between them; a second From opens the next block */
function matchHeaderBlock(lines: readonly string[], start: number): Boundary | undefined {
  const envelope: MutableEnvelope = {};
  let count = 0;
  let end = start;
  for (let cursor = start; cursor < lines.length; cursor++) {
    const line = lines[cursor]!;
    if (line === '') {
      continue;
    }
    const matched = HEADER_LINE.exec(line);
    if (!matched || (count === 0 && matched[1] !== 'From') || (count > 0 && matched[1] === 'From')) {
      break;
    }
    const field = toEnvelopeField(matched[1]!);
    const value = toPlainValue(matched[2]!);
    if (field !== undefined) {
      envelope[field] = field === 'date' || field === 'subject' ? value : toParty(value);
    }
    count += 1;
    end = cursor + 1;
  }
  return count < 2 ? undefined : { end, envelope };
}

/** `On <date> <who> wrote:` on one line, or wrapped before `wrote:`; a time token is what separates the date from the name */
function matchAttribution(lines: readonly string[], start: number): Boundary | undefined {
  const first = toPlainValue(lines[start] ?? '');
  let line = first;
  let end = start + 1;
  if (!ATTRIBUTION.test(first)) {
    const next = toPlainValue(lines[start + 1] ?? '');
    if (!ATTRIBUTION_OPENING.test(first) || !ATTRIBUTION_CLOSING.test(next)) {
      return undefined;
    }
    line = `${first} ${next}`;
    end = start + 2;
  }
  const rest = ATTRIBUTION.exec(line)?.[1];
  if (rest === undefined) {
    return undefined;
  }
  const time = TIME_TOKEN.exec(rest);
  if (!time) {
    return undefined;
  }
  const cut = time.index + time[0].length;
  const from = rest
    .slice(cut)
    .replace(/^[\s,]+/, '')
    .trim();
  return { end, envelope: { date: rest.slice(0, cut).trim(), ...(from === '' ? {} : { from: toParty(from) }) } };
}

/** how many quote markers open the line, a blockquote's `>` and the escaped `\>` of quoting that passed through HTML alike */
export function quoteDepth(line: string): number {
  let depth = 0;
  let rest = line;
  while (QUOTE_PREFIX.test(rest)) {
    rest = rest.replace(QUOTE_PREFIX, '');
    depth += 1;
  }
  return depth;
}

/** the line behind up to `limit` of its leading quote markers; deeper markers stay, still visibly quoting */
export function stripQuotePrefixes(line: string, limit = Number.POSITIVE_INFINITY): string {
  let removed = 0;
  let rest = line;
  while (removed < limit && QUOTE_PREFIX.test(rest)) {
    rest = rest.replace(QUOTE_PREFIX, '');
    removed += 1;
  }
  return rest;
}

/** an envelope value as text: links to their label, escapes and emphasis removed, whitespace collapsed */
export function toPlainValue(markdown: string): string {
  return markdown
    .replaceAll(MARKDOWN_LINK, '$1')
    .replaceAll(MARKDOWN_ESCAPE, '$1')
    .replaceAll('**', '')
    .replaceAll(/\s+/g, ' ')
    .trim();
}

/**
 * A boundary opens on a non-blank line: a header block, optionally behind decoration a client puts
 * before one (a rule, a "Forwarded message" banner), or an attribution line. Decoration with no
 * block behind it is body text — a newsletter's own rules must not split anything.
 */
export function matchBoundary(lines: readonly string[], start: number): Boundary | undefined {
  const line = lines[start] ?? '';
  if (line === '') {
    return undefined;
  }
  if (DECORATION.test(line)) {
    let index = start + 1;
    while (index < lines.length && (lines[index] === '' || DECORATION.test(lines[index]!))) {
      index += 1;
    }
    return matchHeaderBlock(lines, index);
  }
  return matchHeaderBlock(lines, start) ?? matchAttribution(lines, start);
}

export type { Boundary };
