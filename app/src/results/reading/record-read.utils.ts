import { findPhrases, renderPhraseFind } from '@/utils/phrase-find.utils.ts';

const CHARACTER_FORMAT = new Intl.NumberFormat('en-US');

type ReadInput = {
  readonly offset: number;
  readonly output: string;
  readonly recordedAt: string;
  readonly ref: string;
  /** the width of the view the record was shown in, which this read fits whole with its heading and footer */
  readonly widthChars: number;
};

function renderHeading(ref: string, from: number, to: number, total: number, recordedAt: string): string {
  const range = `${CHARACTER_FORMAT.format(from)}–${CHARACTER_FORMAT.format(to)}`;
  return `result ${ref}, characters ${range} of ${CHARACTER_FORMAT.format(total)} (recorded at ${recordedAt}):\n`;
}

function renderFooter(ref: string, to: number, total: number): string {
  return to < total ? `\nread on with offset=${to}` : `\n(the end of result ${ref})`;
}

/** how many of the turn's references a refusal of an unknown one names */
export const LISTED_REFERENCES = 10;

/** §3.8 — what a later turn reads in place of a read: its reference named a result of a turn that is over */
export const READ_REPLAY_LINE = '[read a result of an earlier turn; its references ended with that turn]';

/**
 * §3.8 — one stretch of a result, sized so the stretch, its heading and its footer fit the view the
 * record was shown in, whole: a read never needs a read of its own. Returns where in the text the
 * record's characters begin, so a shortened view of the read can name the record's offset.
 */
export function renderOffsetRead({ offset, output, recordedAt, ref, widthChars }: ReadInput): {
  readonly text: string;
  readonly textIndex: number;
} {
  const total = output.length;
  const longestFooter = Math.max(
    renderFooter(ref, total, total).length,
    renderFooter(ref, Math.max(total - 1, 0), total).length
  );
  const frame = renderHeading(ref, total, total, total, recordedAt).length + longestFooter;
  const to = Math.min(total, offset + Math.max(widthChars - frame, 1));
  const heading = renderHeading(ref, offset, to, total, recordedAt);
  return {
    text: `${heading}${output.slice(offset, to)}${renderFooter(ref, to, total)}`,
    textIndex: heading.length
  };
}

/**
 * §3.8 — each phrase's places in the whole result, at offsets an offset read starts from; or the
 * result itself where it is no longer than its places would be, since it then costs no more.
 */
export function renderRecordFind(input: {
  readonly offsetIgnored: boolean;
  readonly output: string;
  readonly phrases: readonly string[];
  readonly recordedAt: string;
  readonly ref: string;
}): string {
  const { offsetIgnored, output, phrases, recordedAt, ref } = input;
  const found = findPhrases(output, phrases);
  const size = `result ${ref}'s ${CHARACTER_FORMAT.format(output.length)} characters (recorded at ${recordedAt})`;
  const lead = found.some(({ count }) => count > 0)
    ? `Where each phrase occurs in ${size}; read around a place with results__read ref=${ref} offset=<the place's offset>:`
    : `None of these phrases occurs in ${size}. A phrase matches without regard to case or line breaks; try a shorter or a different one.`;
  const ignored = offsetIgnored ? ['offset does not apply to a find; the whole result was searched'] : [];
  const places = [lead, renderPhraseFind(output, found)].join('\n\n');
  const matches = found.reduce((total, { count }) => total + count, 0);
  const whole = `The whole of ${size}, since it is no longer than the places of ${phrases.length === 1 ? 'this phrase' : 'these phrases'} would be (${matches} match${matches === 1 ? '' : 'es'}):\n${output}${renderFooter(ref, output.length, output.length)}`;
  return [...ignored, whole.length <= places.length ? whole : places].join('\n\n');
}

/** §3.8, §7.2 — a reference that names no result of this turn: the ones it may have meant, which the agent was shown */
export function renderUnknownReference(ref: string, refs: readonly string[]): string {
  const known =
    refs.length === 0 ? 'this turn has shown no result by reference' : `its newest results are ${refs.join(', ')}`;
  return `no result ${ref} in this turn; ${known}. A reference lasts only for the turn that made the call; in a later turn, make the call again.`;
}

/** §3.8 — an offset at or past the end of the result it names */
export function renderOffsetPastEnd(ref: string, offset: number, total: number): string {
  return `result ${ref} has ${CHARACTER_FORMAT.format(total)} characters, so offset ${offset} is past its end`;
}
