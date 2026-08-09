import * as fs from 'node:fs';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import { MARKDOWN_CAP_CHARS } from '../web.constants.ts';
import { capMarkdown, toMarkdown } from '../web.utils.ts';

const fixture = (name: string): string => {
  return fs.readFileSync(path.resolve(import.meta.dirname, 'fixtures', `${name}.html`), 'utf-8');
};

describe('toMarkdown', () => {
  it('should carry headings, lists, and inline links across from a static page', () => {
    const markdown = toMarkdown(fixture('static-page'));
    expect(markdown).toContain('# Research Themes');
    expect(markdown).toContain('* Cognitive development across the lifespan');
    expect(markdown).toContain('[research@northmoor.example](mailto:research@northmoor.example)');
  });

  it('should keep a faculty table as a table, so a name stays beside its own email', () => {
    const markdown = toMarkdown(fixture('static-directory'));
    expect(markdown).toContain('| Name | Office | Extension | Email |');
    expect(markdown).toContain(
      '| Duval, P. | 217 BSB | — | [duval@northmoor.example](mailto:duval@northmoor.example) |'
    );
  });

  it('should collapse the alignment padding that carries nothing for a model', () => {
    expect(toMarkdown(fixture('static-directory'))).not.toMatch(/ {2,}/);
  });

  /** the empty string is why the render assertion exists: an unrendered page reads as "no results" */
  it.each(['client-rendered-directory', 'spa-marketing-site'])(
    'should yield nothing at all from %s, since no script has run',
    (name) => {
      expect(toMarkdown(fixture(name))).toBe('');
    }
  );
});

describe('capMarkdown', () => {
  it('should leave any page a real site would serve untouched', () => {
    expect(capMarkdown(toMarkdown(fixture('static-directory')))).toContain('| Duval, P. |');
  });

  it('should cut a page past the guard and say so, rather than shortening it silently', () => {
    const capped = capMarkdown('x'.repeat(MARKDOWN_CAP_CHARS + 1));
    expect(capped).toBe(`${'x'.repeat(MARKDOWN_CAP_CHARS)}\n…page truncated at ${MARKDOWN_CAP_CHARS} characters`);
  });
});
