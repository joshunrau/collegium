import { describe, expect, it } from 'vitest';

import {
  charsetOf,
  classifyContentType,
  classifyFetchError,
  describeFetchError,
  extractTitle,
  rateLimitRetryWaitMs,
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
  it('should say a socket error by its own message', () => {
    expect(describeFetchError(new Error('getaddrinfo ENOTFOUND northmoor.example'))).toBe(
      'getaddrinfo ENOTFOUND northmoor.example'
    );
    expect(describeFetchError('boom')).toBe('boom');
  });

  it("should say a timeout in the framework's words, once (§3.4)", () => {
    const aborted = new Error('The operation was aborted', {
      cause: new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    });
    expect(describeFetchError(aborted)).toBe('the page did not answer within 20s');
    expect(describeFetchError(aborted)).not.toContain('aborted');
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

describe('rateLimitRetryWaitMs (§3.4)', () => {
  const now = Date.parse('2026-09-22T12:00:00Z');
  const deadline = now + 20_000;
  const answer = (status: number, retryAfter?: string) => {
    return { headers: new Headers(retryAfter === undefined ? {} : { 'retry-after': retryAfter }), status };
  };

  it('should wait what the site names, or a second for a 429 that names nothing', () => {
    expect(rateLimitRetryWaitMs(answer(503, '2'), now, deadline)).toBe(2_000);
    expect(rateLimitRetryWaitMs(answer(429), now, deadline)).toBe(1_000);
  });

  it('should not retry a 503 that names no wait, a wait the timeout cannot hold, or a status that is no limit', () => {
    expect(rateLimitRetryWaitMs(answer(503), now, deadline)).toBeUndefined();
    expect(rateLimitRetryWaitMs(answer(429, '15'), now, deadline)).toBeUndefined();
    expect(rateLimitRetryWaitMs(answer(403, '1'), now, deadline)).toBeUndefined();
  });
});
