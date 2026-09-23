import { describe, expect, it } from 'vitest';

import { containsToolCallTranscript, lacksProse } from '../reply-guard.utils.ts';

describe('containsToolCallTranscript', () => {
  it('should recognise the replayed call form, including a fabricated tool name', () => {
    expect(containsToolCallTranscript('[called web__navigate({"url":"http://x"})]')).toBe(true);
    expect(containsToolCallTranscript('Sure.\n[called read_memory({"id":"m1"})]')).toBe(true);
  });

  it('should leave prose that merely mentions a tool alone', () => {
    expect(containsToolCallTranscript('I called web__navigate and it worked')).toBe(false);
    expect(containsToolCallTranscript('')).toBe(false);
  });
});

describe('lacksProse (§4.5)', () => {
  it('should find no prose in markup alone, or in punctuation and symbols', () => {
    expect(lacksProse('<br>\n<hr/>')).toBe(true);
    expect(lacksProse('--- … ---')).toBe(true);
  });

  it('should read a link written in angle brackets as prose, not as markup', () => {
    expect(lacksProse('<https://example.com/report>')).toBe(false);
    expect(lacksProse('<casey@example.com>')).toBe(false);
  });

  it('should find no prose in one line repeated five times that makes up most of the reply', () => {
    expect(lacksProse(Array.from({ length: 5 }, () => '<dcp-message-id>dcp-message-id>').join('\n'))).toBe(true);
  });

  it('should find prose in a reply in any script, and in a list whose repeated line is the minority', () => {
    expect(lacksProse('完成了。')).toBe(false);
    const table = [
      '| venue | price |',
      ...Array.from({ length: 5 }, (_, index) => `| hall ${index} | TBD |`),
      '| — | — |'
    ];
    expect(lacksProse([...table, '| — | — |', '| — | — |', '| — | — |', '| — | — |'].join('\n'))).toBe(false);
  });
});
