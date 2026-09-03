import type { MailSegment, MailSegmentEnvelope } from './thread.types.ts';

type EnvelopeField = keyof MailSegmentEnvelope;

const LABELS: { readonly [Field in EnvelopeField]: string } = {
  cc: 'Cc',
  date: 'Date',
  from: 'From',
  subject: 'Subject',
  to: 'To'
};

/** the uniform three-field envelope an announcement shows on every segment */
const ANNOUNCEMENT_ENVELOPE: readonly EnvelopeField[] = ['from', 'date', 'subject'];

/** everything a boundary quoted, for a reader who opened the message in full */
const FULL_ENVELOPE: readonly EnvelopeField[] = ['from', 'date', 'to', 'cc', 'subject'];

function renderSegment(segment: MailSegment, fields: readonly EnvelopeField[]): string {
  const envelope = fields
    .flatMap((field) => {
      const value = segment.envelope[field];
      return value === undefined ? [] : [`**${LABELS[field]}:** ${value}`];
    })
    .join('\n');
  return [envelope, segment.body].filter((part) => part !== '').join('\n\n');
}

/** every segment under the chosen envelope fields it has, a rule between segments */
export function renderMailSegments(segments: readonly MailSegment[], fields: readonly EnvelopeField[]): string {
  return segments.map((segment) => renderSegment(segment, fields)).join('\n\n---\n\n');
}

export function quoteMarkdown(markdown: string): string {
  return markdown
    .split('\n')
    .map((line) => (line === '' ? '>' : `> ${line}`))
    .join('\n');
}

export { ANNOUNCEMENT_ENVELOPE, FULL_ENVELOPE };
