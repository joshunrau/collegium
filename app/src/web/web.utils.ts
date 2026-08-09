import { NodeHtmlMarkdown } from 'node-html-markdown';

import { MARKDOWN_CAP_CHARS } from './web.constants.ts';

const TABLE_SEPARATOR_ROW = /^\|[\s|:-]+\|$/;

/**
 * node-html-markdown pads table cells so columns line up for a human reader. The reader here is a
 * model, and on a real faculty directory that padding is 44% of the output — so it is collapsed
 * away. Only table rows are touched; indentation elsewhere is meaningful.
 */
function collapseTableRow(line: string): string {
  if (!line.startsWith('|')) {
    return line;
  }
  const collapsed = line.replaceAll(/ {2,}/g, ' ');
  return TABLE_SEPARATOR_ROW.test(collapsed) ? collapsed.replaceAll(/-{2,}/g, '---') : collapsed;
}

/** Cleaned, post-render HTML to the markdown a model reads. Tables survive as tables (§3.4). */
export function toMarkdown(html: string): string {
  return NodeHtmlMarkdown.translate(html).split('\n').map(collapseTableRow).join('\n').trim();
}

/** A page past the guard is cut and says so — a truncation the model cannot see is one it reasons past. */
export function capMarkdown(markdown: string): string {
  if (markdown.length <= MARKDOWN_CAP_CHARS) {
    return markdown;
  }
  return `${markdown.slice(0, MARKDOWN_CAP_CHARS)}\n…page truncated at ${MARKDOWN_CAP_CHARS} characters`;
}
