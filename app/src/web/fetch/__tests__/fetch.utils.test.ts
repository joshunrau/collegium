import { describe, expect, it } from 'vitest';

import {
  charsetOf,
  classifyContentType,
  classifyFetchError,
  describeFetchError,
  extractTitle,
  toDecoder
} from '../fetch.utils.ts';

const STATIC_PAGE =
  '<!doctype html><html><head><title>Research Themes — Northmoor University</title></head><body><h1>Research Themes</h1><p>Enquiries go to research@northmoor.example.</p></body></html>';

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

  it.each(['application/pdf', 'application/x-pdf'])('should read %s as a PDF', (contentType) => {
    expect(classifyContentType(contentType)).toBe('pdf');
  });

  it.each(['image/png', 'application/octet-stream'])('should refuse %s', (contentType) => {
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

  it('should decode the character references a title is written with', () => {
    expect(extractTitle('<title>Faculty &amp; Staff &ndash; Northmoor&#8217;s Psychology</title>')).toBe(
      'Faculty & Staff – Northmoor’s Psychology'
    );
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

describe('classifyFetchError', () => {
  const failed = (code: string) => Object.assign(new Error(`${code} message`), { code });

  it.each([
    ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'incomplete-chain'],
    ['UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'untrusted-issuer'],
    ['SELF_SIGNED_CERT_IN_CHAIN', 'untrusted-issuer'],
    ['DEPTH_ZERO_SELF_SIGNED_CERT', 'self-signed'],
    ['CERT_HAS_EXPIRED', 'expired'],
    ['ERR_TLS_CERT_ALTNAME_INVALID', 'name-mismatch'],
    ['CERT_REVOKED', 'unclassified']
  ])('should classify %s as %s by its code alone (§3.4)', (code, reason) => {
    expect(classifyFetchError(failed(code))).toStrictEqual({ code, kind: 'tls', reason });
  });

  it('should leave a failure that is not TLS as a page that did not load', () => {
    expect(classifyFetchError(failed('ECONNREFUSED'))).toStrictEqual({
      kind: 'navigation',
      message: 'ECONNREFUSED message'
    });
  });
});
