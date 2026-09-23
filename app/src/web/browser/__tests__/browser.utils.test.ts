import { describe, expect, it } from 'vitest';

import { classifyActionError, classifyNavigationError } from '../browser.utils.ts';

describe('classifyNavigationError', () => {
  it("should say the browser's transport errors in plain words", () => {
    expect(classifyNavigationError('page.goto: NS_ERROR_UNKNOWN_HOST')).toStrictEqual({
      kind: 'navigation',
      message: 'the host name does not resolve'
    });
    expect(classifyNavigationError('page.goto: NS_ERROR_CONNECTION_REFUSED')).toMatchObject({
      message: 'the connection was refused'
    });
    expect(classifyNavigationError('page.goto: NS_ERROR_NET_TIMEOUT')).toMatchObject({
      message: 'the page did not answer within 30s'
    });
    expect(classifyNavigationError('page.goto: NS_ERROR_NET_EMPTY_RESPONSE')).toMatchObject({
      message: 'the connection was closed with no response: the host refused it or could not be reached'
    });
  });

  it('should pass a message it does not know through unchanged', () => {
    expect(classifyNavigationError('page.goto: Navigation interrupted by another navigation')).toStrictEqual({
      kind: 'navigation',
      message: 'page.goto: Navigation interrupted by another navigation'
    });
  });

  it.each([
    ['SEC_ERROR_UNKNOWN_ISSUER', 'untrusted-issuer'],
    ['SEC_ERROR_EXPIRED_CERTIFICATE', 'expired'],
    ['SSL_ERROR_BAD_CERT_DOMAIN', 'name-mismatch'],
    ['MOZILLA_PKIX_ERROR_SELF_SIGNED_CERT', 'self-signed'],
    ['SSL_ERROR_NO_CYPHER_OVERLAP', 'unclassified']
  ])('should classify %s as a TLS failure of kind %s (§3.4)', (code, reason) => {
    expect(
      classifyNavigationError(`page.goto: ${code}\nCall log:\n  - navigating to "https://northmoor.example/"`)
    ).toStrictEqual({
      code,
      kind: 'tls',
      reason
    });
  });
});

describe('classifyActionError', () => {
  it("should report an element's refusal as the element's, without Playwright's framing (§3.4)", () => {
    const message =
      'locator.fill: Error: Element is not an <input>, <textarea> or [contenteditable] element\nCall log:\n  - waiting for locator';
    expect(classifyActionError(message, 'e359')).toStrictEqual({
      kind: 'action-failed',
      message: 'Element is not an <input>, <textarea> or [contenteditable] element',
      ref: 'e359'
    });
  });

  it('should report a load the action started as the page failing to load', () => {
    expect(classifyActionError('locator.click: NS_ERROR_NET_EMPTY_RESPONSE', 'e4')).toMatchObject({
      kind: 'navigation'
    });
  });
});
