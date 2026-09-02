import * as fs from 'node:fs';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import { toMarkdown } from '../../web.utils.ts';
import {
  charsetOf,
  classifyContentType,
  describeFetchError,
  extractTitle,
  needsClientRendering,
  toDecoder
} from '../fetch.utils.ts';

const fixture = (name: string): string => {
  return fs.readFileSync(
    path.resolve(import.meta.dirname, '..', '..', '__tests__', 'fixtures', `${name}.html`),
    'utf-8'
  );
};

describe('classifyContentType', () => {
  it.each(['text/html; charset=utf-8', 'application/xhtml+xml', ''])('should read %s as html', (contentType) => {
    expect(classifyContentType(contentType)).toBe('html');
  });

  it.each(['text/plain', 'text/csv', 'application/json', 'application/xml', 'application/ld+json', 'image/svg+xml'])(
    'should hand %s over as text',
    (contentType) => {
      expect(classifyContentType(contentType)).toBe('text');
    }
  );

  it.each(['application/pdf', 'image/png', 'application/octet-stream'])('should refuse %s', (contentType) => {
    expect(classifyContentType(contentType)).toBe('unsupported');
  });
});

describe('charsetOf', () => {
  it('should read the charset parameter, quoted or bare, and default to utf-8', () => {
    expect(charsetOf('text/html; charset=ISO-8859-1')).toBe('iso-8859-1');
    expect(charsetOf('text/html; charset="windows-1252"')).toBe('windows-1252');
    expect(charsetOf('text/html')).toBe('utf-8');
  });
});

describe('toDecoder', () => {
  it('should fall back to utf-8 for a charset the runtime does not know', () => {
    expect(toDecoder('iso-8859-1').encoding).toBe('windows-1252');
    expect(toDecoder('x-not-a-charset').encoding).toBe('utf-8');
  });
});

describe('extractTitle', () => {
  it('should read the document title, trimmed, and nothing when there is none', () => {
    expect(extractTitle(fixture('static-page'))).not.toBe('');
    expect(extractTitle('<html><head><title>\n  Faculty \n</title></head></html>')).toBe('Faculty');
    expect(extractTitle('<h1>No title</h1>')).toBe('');
  });
});

describe('describeFetchError', () => {
  it('should surface the cause undici hides behind "fetch failed"', () => {
    expect(describeFetchError(new Error('fetch failed', { cause: new Error('getaddrinfo ENOTFOUND') }))).toBe(
      'fetch failed: getaddrinfo ENOTFOUND'
    );
    expect(describeFetchError(new Error('aborted'))).toBe('aborted');
    expect(describeFetchError('boom')).toBe('boom');
  });
});

describe('needsClientRendering', () => {
  it.each(['spa-marketing-site', 'client-rendered-directory'])('should refuse %s, which reads as nothing', (name) => {
    expect(needsClientRendering(toMarkdown(fixture(name)))).toBe(true);
  });

  it('should admit a page with static content', () => {
    expect(needsClientRendering(toMarkdown(fixture('static-page')))).toBe(false);
  });
});
