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

const STATIC_PAGE =
  '<!doctype html><html><head><title>Research Themes — Northmoor University</title></head><body><h1>Research Themes</h1><p>Enquiries go to research@northmoor.example.</p></body></html>';

/** a shell whose every word arrives by script: nothing for markdown to carry */
const CLIENT_RENDERED_PAGES = {
  'client-rendered-directory':
    '<!doctype html><html><head><title>Faculty</title></head><body><div id="directory"></div><script src="/directory.js"></script></body></html>',
  'spa-marketing-site':
    '<!doctype html><html><head><title>Northmoor</title></head><body><div id="app"></div><script src="/app.js"></script></body></html>'
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
    expect(extractTitle(STATIC_PAGE)).not.toBe('');
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
  it.each(Object.entries(CLIENT_RENDERED_PAGES))('should refuse %s, which reads as nothing', (_name, html) => {
    expect(needsClientRendering(toMarkdown(html))).toBe(true);
  });

  it('should admit a page with static content', () => {
    expect(needsClientRendering(toMarkdown(STATIC_PAGE))).toBe(false);
  });
});
