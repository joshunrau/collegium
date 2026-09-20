import { describe, expect, it } from 'vitest';

import {
  fenceCodeBlock,
  listProseRanges,
  preventWrappingAtHyphens,
  quoteBlock,
  renderCodeSpan,
  renderTable
} from '../markdown.utils.ts';

const prose = (text: string): string[] => listProseRanges(text).map((range) => text.slice(range.start, range.end));

describe('fenceCodeBlock', () => {
  it('should fence a body without backticks in three', () => {
    expect(fenceCodeBlock('ls -la', 'sh')).toBe('```sh\nls -la\n```');
  });

  it('should fence a body one backtick longer than its longest run, so it renders whole', () => {
    expect(fenceCodeBlock('```\n[ls](https://evil)')).toBe('````\n```\n[ls](https://evil)\n````');
    expect(fenceCodeBlock('a ```` b')).toBe('`````\na ```` b\n`````');
  });
});

describe('renderCodeSpan', () => {
  it('should delimit a span with more backticks than it holds, padding one that begins with a backtick', () => {
    expect(renderCodeSpan('notes.md')).toBe('`notes.md`');
    expect(renderCodeSpan('a`b')).toBe('``a`b``');
    expect(renderCodeSpan('`x')).toBe('`` `x ``');
  });
});

describe('quoteBlock', () => {
  it('should mark every line, so a blank line does not break the quote in two', () => {
    expect(quoteBlock('## Heading\n\nBody.')).toBe('> ## Heading\n>\n> Body.');
  });
});

describe('renderTable', () => {
  it('should render a header, its delimiter and one row per entry', () => {
    expect(renderTable(['Tool', 'Use'], [['now', 'the clock']])).toBe(
      '| Tool | Use |\n| --- | --- |\n| now | the clock |'
    );
  });

  it('should keep a cell on its own line and inside its own column', () => {
    expect(renderTable(['Skill'], [['reads a\nsecond line | and a pipe']])).toBe(
      '| Skill |\n| --- |\n| reads a second line \\| and a pipe |'
    );
  });
});

describe('preventWrappingAtHyphens', () => {
  it('should join the parts of a hyphenated name without changing what it reads as', () => {
    const joined = preventWrappingAtHyphens('saving-bookmarks');
    expect(joined).toBe('saving-⁠bookmarks');
    expect(joined.replaceAll('⁠', '')).toBe('saving-bookmarks');
  });
});

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
