import { describe, expect, it } from 'vitest';

import { TextFormatter } from '../text.formatter.ts';

describe('TextFormatter', () => {
  const textFormatter = new TextFormatter();

  it('should render items as a bulleted list', () => {
    expect(textFormatter.formatBullets(['one', 'two'])).toBe('- one\n- two');
  });

  it('should join items as an English conjunction', () => {
    expect(textFormatter.formatConjunction(['a'])).toBe('a');
    expect(textFormatter.formatConjunction(['a', 'b', 'c'])).toBe('a, b, and c');
  });

  it('should fill every placeholder across the paragraphs and separate them by a blank line', () => {
    expect(
      textFormatter.formatParagraphs(['## Heading', 'The budget is {budget}.', 'Calls to {exempt} are free.'], {
        budget: 7,
        exempt: 'skills__load'
      })
    ).toBe('## Heading\n\nThe budget is 7.\n\nCalls to skills__load are free.');
  });
});
