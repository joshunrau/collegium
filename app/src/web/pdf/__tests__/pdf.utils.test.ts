import { describe, expect, it } from 'vitest';

import { MARKDOWN_CAP_CHARS, PDF_READ_MEMORY_CAP_BYTES, PDF_READ_TIMEOUT_MS } from '../../web.constants.ts';
import { isWithoutTextLayer, readPdfText } from '../pdf.utils.ts';

import type { PageRead } from '../../web.types.ts';

const FROM_THE_TOP: PageRead = { kind: 'window', startChar: 0, wholePage: false };

describe('readPdfText', () => {
  it('should mark every page, saying where one carries no text (§3.4)', () => {
    const { markdown } = readPdfText(
      { pageCount: 3, pages: ['Faculty   Handbook \n Contents', ' ', 'Duval, P.'] },
      FROM_THE_TOP
    );
    const text = '[page 1 of 3]\nFaculty Handbook\nContents\n\n[page 2 of 3: no text]\n\n[page 3 of 3]\nDuval, P.';
    expect(markdown).toBe(
      'A PDF of 3 pages, read as its text layer: a figure or a scanned page reads as nothing, and a table as ' +
        `lines of text.\n\n${text}\n…end of page, ${text.length} characters in all`
    );
  });

  it('should say where a read that stopped early stopped, and why', () => {
    const cut = readPdfText({ pageCount: 400, pages: ['a', 'b'], stoppedBy: 'char-limit' }, FROM_THE_TOP);
    expect(cut.markdown).toContain(
      `A PDF of 400 pages, read as its text layer up to page 2, where it passed ${MARKDOWN_CAP_CHARS} characters;`
    );
    const late = readPdfText({ pageCount: 400, pages: ['a'], stoppedBy: 'deadline' }, FROM_THE_TOP);
    expect(late.markdown).toContain(
      `A PDF of 400 pages, read as its text layer up to page 1 in the ${PDF_READ_TIMEOUT_MS / 1000} seconds`
    );
    const heavy = readPdfText({ pageCount: 400, pages: ['a'], stoppedBy: 'memory-limit' }, FROM_THE_TOP);
    expect(heavy.markdown).toContain(
      `A PDF of 400 pages, read as its text layer up to page 1, where reading the next page took more than the ` +
        `${PDF_READ_MEMORY_CAP_BYTES / 1_000_000} MB of memory one read may use;`
    );
  });

  it('should find a phrase at an offset a window reads from', () => {
    const handbook = `Faculty Handbook\n${'Policies and procedures. '.repeat(200)}`;
    const text = { pageCount: 2, pages: [handbook, 'Duval, P. — duval@northmoor.example'] };
    const found = readPdfText(text, { kind: 'find', phrases: ['duval@'], wholePage: false });
    const offset = Number(/— 1 match at (\d+)/u.exec(found.markdown)?.[1]);
    const window = readPdfText(text, { kind: 'window', maxChars: 1_000, startChar: offset, wholePage: false });
    expect(window.markdown).toContain('\n\nduval@northmoor.example\n');
  });
});

describe('isWithoutTextLayer', () => {
  it('should hold for a document whose every page is blank, and not for one with any text', () => {
    expect(isWithoutTextLayer({ pageCount: 2, pages: ['', ' \n '] })).toBe(true);
    expect(isWithoutTextLayer({ pageCount: 2, pages: ['', 'Duval'] })).toBe(false);
  });

  it('should not hold for a read the deadline stopped, however blank the pages it reached (§3.4)', () => {
    expect(isWithoutTextLayer({ pageCount: 30, pages: [''], stoppedBy: 'deadline' })).toBe(false);
  });
});
