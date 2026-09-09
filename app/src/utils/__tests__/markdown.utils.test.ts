import { describe, expect, it } from 'vitest';

import { listProseRanges } from '../markdown.utils.ts';

const prose = (text: string): string[] => listProseRanges(text).map((range) => text.slice(range.start, range.end));

describe('listProseRanges', () => {
  it('should return the whole text when it holds no code', () => {
    expect(prose('hello world')).toStrictEqual(['hello world']);
  });

  it('should drop a fenced block, its fences included, and close only on a matching fence', () => {
    expect(prose('a\n```\ncode\n~~~\nmore\n```\nb')).toStrictEqual(['a', 'b']);
    expect(prose('a\n````\n```\n````\nb')).toStrictEqual(['a', 'b']);
  });

  it('should drop an indented block only where it does not continue a paragraph', () => {
    expect(prose('a\n\n    code\nb')).toStrictEqual(['a', 'b']);
    expect(prose('a\n    still a')).toStrictEqual(['a\n    still a']);
  });

  it('should cut inline code spans out of a paragraph, pairing runs by length', () => {
    expect(prose('a `b` c ``d ` e`` f')).toStrictEqual(['a ', ' c ', ' f']);
  });

  it('should never pair a code span across a blank line', () => {
    expect(prose('a `b\n\nc` d')).toStrictEqual(['a `b', 'c` d']);
  });
});
