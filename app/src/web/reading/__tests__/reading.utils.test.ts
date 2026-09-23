import { describe, expect, it } from 'vitest';

import { DEFAULT_WINDOW_CHARS, MARKDOWN_CAP_CHARS } from '../../web.constants.ts';
import { capMarkdown, windowMarkdown } from '../reading.utils.ts';

describe('capMarkdown', () => {
  it('should leave a page within the guard untouched', () => {
    const markdown = 'x'.repeat(MARKDOWN_CAP_CHARS);
    expect(capMarkdown(markdown)).toStrictEqual({ markdown });
  });

  it('should say how much of the page it cut, not only where it cut it', () => {
    const capped = capMarkdown('x'.repeat(MARKDOWN_CAP_CHARS + 1));
    expect(capped).toStrictEqual({
      markdown: `${'x'.repeat(MARKDOWN_CAP_CHARS)}\n…page truncated at ${MARKDOWN_CAP_CHARS} of ${MARKDOWN_CAP_CHARS + 1} characters`,
      shown: { from: 0, to: MARKDOWN_CAP_CHARS, total: MARKDOWN_CAP_CHARS + 1 }
    });
  });
});

describe('windowMarkdown (§3.8)', () => {
  it('should state that a page ended where the result ended (§3.8)', () => {
    expect(windowMarkdown('short', 0)).toStrictEqual({ markdown: 'short\n…end of page, 5 characters in all' });
  });

  it('should read a page past the default window in parts, saying where to read on and how to reach the end', () => {
    const total = DEFAULT_WINDOW_CHARS + 10;
    const windowed = windowMarkdown('x'.repeat(total), 0);
    expect(windowed.markdown).toMatch(
      new RegExp(
        `x\\n…showing characters 0–${DEFAULT_WINDOW_CHARS} of ${total}; read on with startChar=${DEFAULT_WINDOW_CHARS}, or startChar=-20000 for the end$`,
        'u'
      )
    );
    expect(windowed.shown).toStrictEqual({ from: 0, to: DEFAULT_WINDOW_CHARS, total });
  });

  it('should never read past the guard, whatever width is asked for', () => {
    const total = MARKDOWN_CAP_CHARS + 10;
    expect(windowMarkdown('x'.repeat(total), 0, total).shown).toStrictEqual({ from: 0, to: MARKDOWN_CAP_CHARS, total });
  });

  it('should return only the requested window and still say where to read on', () => {
    expect(windowMarkdown('0123456789', 0, 4)).toStrictEqual({
      markdown: '0123\n…showing characters 0–4 of 10; read on with startChar=4, or startChar=-20000 for the end',
      shown: { from: 0, to: 4, total: 10 }
    });
  });

  it('should read a negative startChar as an offset from the end of the page', () => {
    expect(windowMarkdown('0123456789', -3)).toStrictEqual({
      markdown: '789\n…showing characters 7–10 of 10',
      shown: { from: 7, to: 10, total: 10 }
    });
  });

  it('should read from the offset to the end, and say so without an invitation to read on', () => {
    expect(windowMarkdown('0123456789', 7)).toStrictEqual({
      markdown: '789\n…showing characters 7–10 of 10',
      shown: { from: 7, to: 10, total: 10 }
    });
  });

  it('should say when the offset is past the end rather than return nothing', () => {
    expect(windowMarkdown('0123456789', 10).markdown).toBe(
      '…startChar 10 is past the end of this page, which has 10 characters'
    );
  });
});
