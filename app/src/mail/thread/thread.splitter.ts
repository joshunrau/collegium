import { matchBoundary, quoteDepth, stripQuotePrefixes } from './thread.grammar.ts';

import type { MailSegment, MailSegmentEnvelope, MailThread } from './thread.types.ts';

type OpenSegment = {
  readonly envelope: MailSegmentEnvelope;
  readonly lines: string[];
};

function toBody(lines: readonly string[]): string {
  return lines
    .join('\n')
    .replaceAll(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * A segment sheds only the quoting its own client added — the shallowest depth among its lines.
 * Anything quoted deeper is a message no boundary claimed, and it stays visibly quoted rather than
 * merging into words under someone else's name.
 */
function close(segment: OpenSegment): MailSegment {
  const depth = Math.min(
    ...segment.lines.filter((line) => stripQuotePrefixes(line).trim() !== '').map((line) => quoteDepth(line))
  );
  const lines = segment.lines.map((line) => stripQuotePrefixes(line, depth).trimEnd());
  return { body: toBody(lines), envelope: segment.envelope };
}

/**
 * Deterministic and flat: each boundary a client wrote opens the segment it describes, whatever
 * depth the quoting nested it at. Boundaries are recognised behind every quote marker; the sender's
 * own words keep theirs untouched, so quoting nobody claimed is never dropped.
 */
export function splitMailThread(body: string): MailThread {
  const lines = body
    .replaceAll('\r\n', '\n')
    .replaceAll(' ', ' ')
    .split('\n')
    .map((line) => line.trimEnd());
  const stripped = lines.map((line) => stripQuotePrefixes(line).trimEnd());
  const head: string[] = [];
  const quoted: MailSegment[] = [];
  let open: OpenSegment | undefined;
  let index = 0;
  while (index < lines.length) {
    const boundary = matchBoundary(stripped, index);
    if (boundary) {
      if (open) {
        quoted.push(close(open));
      }
      open = { envelope: boundary.envelope, lines: [] };
      index = boundary.end;
      continue;
    }
    (open ? open.lines : head).push(lines[index]!);
    index += 1;
  }
  if (open) {
    quoted.push(close(open));
  }
  return { headBody: toBody(head), quoted };
}
