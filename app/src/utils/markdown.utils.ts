type TextRange = { readonly end: number; readonly start: number };

const FENCE_OPENING = /^ {0,3}(`{3,}|~{3,})/u;
const INDENTED_CODE = /^(?: {4}|\t)/u;
const BACKTICK_RUN = /`+/gu;

/** zero-width and non-printing: it removes a break opportunity without changing what the text reads as */
const WORD_JOINER = '⁠';

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

/** a cell is one line of the table's own row, so a newline inside one would end the row early */
function renderTableRow(cells: readonly string[]): string {
  const escaped = cells.map((cell) => cell.replaceAll(/\s*\n\s*/gu, ' ').replaceAll('|', '\\|'));
  return `| ${escaped.join(' | ')} |`;
}

function measureLongestBacktickRun(content: string): number {
  return Array.from(content.matchAll(BACKTICK_RUN)).reduce((longest, match) => Math.max(longest, match[0].length), 0);
}

/** a fence one backtick longer than any run in `content`: CommonMark closes a fence only on a run at least as long */
export function fenceCodeBlock(content: string, language = ''): string {
  const fence = '`'.repeat(Math.max(3, measureLongestBacktickRun(content) + 1));
  return `${fence}${language}\n${content}\n${fence}`;
}

/** the inline counterpart; the padding keeps a leading or trailing backtick from joining the delimiter, and CommonMark strips it */
export function renderCodeSpan(content: string): string {
  const delimiter = '`'.repeat(measureLongestBacktickRun(content) + 1);
  const padding = content.startsWith('`') || content.endsWith('`') ? ' ' : '';
  return `${delimiter}${padding}${content}${padding}${delimiter}`;
}

/** a blank line carries the marker too, so one quote holds the whole block instead of breaking at every gap */
export function quoteBlock(content: string): string {
  return content
    .split('\n')
    .map((line) => (line === '' ? '>' : `> ${line}`))
    .join('\n');
}

export function renderTable(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const delimiter = header.map(() => '---');
  return [renderTableRow(header), renderTableRow(delimiter), ...rows.map(renderTableRow)].join('\n');
}

/** a renderer breaks a narrow table cell at each hyphen, which splits a name across lines; the joiner holds it whole */
export function preventWrappingAtHyphens(text: string): string {
  return text.replaceAll('-', `-${WORD_JOINER}`);
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
