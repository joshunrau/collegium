import { readPage } from '../reading/reading.utils.ts';
import { MARKDOWN_CAP_CHARS, PDF_READ_TIMEOUT_MS } from '../web.constants.ts';

import type { FetchedPage, PageRead } from '../web.types.ts';
import type { PdfReadBudget, PdfText } from './pdf.types.ts';

/** PDF.js hands back a text item's own spacing, which pads columns with runs of blanks */
function normalizePageText(text: string): string {
  return text
    .replaceAll(/[^\S\n]+/gu, ' ')
    .replaceAll(/ ?\n ?/gu, '\n')
    .replaceAll(/\n{3,}/gu, '\n\n')
    .trim();
}

function renderPages(pageCount: number): string {
  return `${pageCount} page${pageCount === 1 ? '' : 's'}`;
}

function describeRead({ pageCount, pages, stoppedBy }: PdfText): string {
  const document = `A PDF of ${renderPages(pageCount)}, read as its text layer`;
  if (stoppedBy === 'char-limit') {
    return `${document} up to page ${pages.length}, where it passed ${MARKDOWN_CAP_CHARS} characters; the pages after it are not read.`;
  }
  if (stoppedBy === 'deadline') {
    return `${document} up to page ${pages.length} in the ${PDF_READ_TIMEOUT_MS / 1000} seconds one read may take; the pages after it are not read.`;
  }
  return `${document}: a figure or a scanned page reads as nothing, and a table as lines of text.`;
}

/** §3.4 — a page that carries no text says so at its marker, since a scanned page among typed ones reads as a gap otherwise */
function renderPage(text: string, index: number, pageCount: number): string {
  const normalized = normalizePageText(text);
  const marker = `[page ${index + 1} of ${pageCount}`;
  return normalized === '' ? `${marker}: no text]` : `${marker}]\n${normalized}`;
}

/** §3.4 — one read's bounds, starting now: the ceiling a fetched page's markdown has, and a deadline of its own */
export function createPdfReadBudget(): PdfReadBudget {
  return { deadline: AbortSignal.timeout(PDF_READ_TIMEOUT_MS), maxChars: MARKDOWN_CAP_CHARS };
}

/**
 * every page was read and none carries text: the document is images of pages, most likely a scan.
 * A read the budget stopped says nothing of the pages it never reached, and a blank cover page is
 * no scan.
 */
export function isWithoutTextLayer(text: PdfText): boolean {
  return text.stoppedBy === undefined && text.pages.every((page) => normalizePageText(page) === '');
}

/**
 * §3.4 — a PDF's text layer read as the call asked, each page under a marker naming its number, so
 * offsets and phrases found in it land on a page the model can cite. What the read covered heads
 * the result, outside the text a window counts.
 */
export function readPdfText(text: PdfText, read: PageRead): Pick<FetchedPage, 'markdown' | 'matches' | 'shown'> {
  const markdown = text.pages.map((page, index) => renderPage(page, index, text.pageCount)).join('\n\n');
  const result = readPage({ leftOutChars: 0, markdown }, read);
  return { ...result, markdown: `${describeRead(text)}\n\n${result.markdown}` };
}
