import { describe, expect, it } from 'vitest';

import { ANNOUNCEMENT_ENVELOPE, FULL_ENVELOPE, quoteMarkdown, renderMailSegments } from '../thread.renderer.ts';

const SEGMENTS = [
  {
    body: 'Newest words',
    envelope: { date: 'today', from: 'Jane Doe <jane@example.com>', subject: 'Re: Hello', to: 'sam@example.com' }
  },
  { body: 'Older words', envelope: { date: 'yesterday', from: 'sam@example.com' } }
];

describe('renderMailSegments', () => {
  it('should render each segment under the announcement envelope, a rule between them', () => {
    expect(renderMailSegments(SEGMENTS, ANNOUNCEMENT_ENVELOPE)).toBe(
      '**From:** Jane Doe <jane@example.com>\n**Date:** today\n**Subject:** Re: Hello\n\nNewest words\n\n---\n\n**From:** sam@example.com\n**Date:** yesterday\n\nOlder words'
    );
  });

  it('should render To and Cc when asked for the full envelope', () => {
    expect(renderMailSegments(SEGMENTS.slice(0, 1), FULL_ENVELOPE)).toBe(
      '**From:** Jane Doe <jane@example.com>\n**Date:** today\n**To:** sam@example.com\n**Subject:** Re: Hello\n\nNewest words'
    );
  });

  it('should render a segment with no envelope as its body alone', () => {
    expect(renderMailSegments([{ body: 'words', envelope: {} }], FULL_ENVELOPE)).toBe('words');
  });
});

describe('quoteMarkdown', () => {
  it('should prefix every line, leaving blank lines as a bare marker', () => {
    expect(quoteMarkdown('one\n\ntwo')).toBe('> one\n>\n> two');
  });
});
