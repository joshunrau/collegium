type TextRange = { readonly end: number; readonly start: number };

const FENCE_OPENING = /^ {0,3}(`{3,}|~{3,})/u;
const INDENTED_CODE = /^(?: {4}|\t)/u;
const BACKTICK_RUN = /`+/gu;

type LineKind = 'blank' | 'code' | 'prose';

function classifyLines(text: string): { end: number; kind: LineKind; start: number }[] {
  const lines: { end: number; kind: LineKind; start: number }[] = [];
  let fence: string | undefined;
  let previous: LineKind = 'blank';
  let start = 0;
  for (const line of text.split('\n')) {
    const end = start + line.length;
    const fenceMarker = FENCE_OPENING.exec(line)?.[1];
    let kind: LineKind;
    if (fence !== undefined) {
      kind = 'code';
      if (fenceMarker?.startsWith(fence[0]!) && fenceMarker.length >= fence.length && line.trim() === fenceMarker) {
        fence = undefined;
      }
    } else if (fenceMarker !== undefined) {
      fence = fenceMarker;
      kind = 'code';
    } else if (line.trim() === '') {
      kind = 'blank';
    } else if (INDENTED_CODE.test(line) && previous !== 'prose') {
      kind = 'code';
    } else {
      kind = 'prose';
    }
    lines.push({ end, kind, start });
    previous = kind;
    start = end + 1;
  }
  return lines;
}

/** the parts of one paragraph outside its inline code spans, in CommonMark's backtick-run pairing */
function splitAroundCodeSpans(text: string, paragraph: TextRange): TextRange[] {
  const ranges: TextRange[] = [];
  const body = text.slice(paragraph.start, paragraph.end);
  const runs = Array.from(body.matchAll(BACKTICK_RUN), (match) => ({ index: match.index, length: match[0].length }));
  let cursor = 0;
  for (let index = 0; index < runs.length; index += 1) {
    const opening = runs[index]!;
    if (opening.index < cursor) {
      continue;
    }
    const closingIndex = runs.findIndex((run, candidate) => candidate > index && run.length === opening.length);
    if (closingIndex === -1) {
      continue;
    }
    const closing = runs[closingIndex]!;
    ranges.push({ end: paragraph.start + opening.index, start: paragraph.start + cursor });
    cursor = closing.index + closing.length;
    index = closingIndex;
  }
  ranges.push({ end: paragraph.end, start: paragraph.start + cursor });
  return ranges.filter((range) => range.end > range.start);
}

/**
 * The spans of a Markdown message that render as text: outside fenced and indented code blocks and
 * inline code spans, split at blank lines so a code span never pairs across paragraphs.
 */
export function listProseRanges(text: string): TextRange[] {
  const paragraphs: TextRange[] = [];
  let open: TextRange | undefined;
  for (const line of classifyLines(text)) {
    if (line.kind === 'prose') {
      open = open ? { end: line.end, start: open.start } : { end: line.end, start: line.start };
      continue;
    }
    if (open) {
      paragraphs.push(open);
      open = undefined;
    }
  }
  if (open) {
    paragraphs.push(open);
  }
  return paragraphs.flatMap((paragraph) => splitAroundCodeSpans(text, paragraph));
}
