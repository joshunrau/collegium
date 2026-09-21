import { describe, expect, it } from 'vitest';

import { describeNavigationError } from '../browser.utils.ts';

describe('describeNavigationError', () => {
  it("should say the browser's transport errors in plain words", () => {
    expect(describeNavigationError('page.goto: NS_ERROR_UNKNOWN_HOST')).toBe('the host name does not resolve');
    expect(describeNavigationError('page.goto: NS_ERROR_CONNECTION_REFUSED')).toBe('the connection was refused');
    expect(describeNavigationError('page.goto: NS_ERROR_NET_TIMEOUT')).toBe('the page did not answer within 30s');
  });

  it('should name both causes of an empty response, since a policy refusal looks like a dead host (§3.4)', () => {
    expect(describeNavigationError('page.goto: NS_ERROR_NET_EMPTY_RESPONSE')).toBe(
      "the connection was accepted and closed with no response: the host, or this deployment's URL policy, refused it"
    );
  });

  it('should pass a message it does not know through unchanged', () => {
    expect(describeNavigationError('not an HTML page: application/pdf')).toBe('not an HTML page: application/pdf');
  });
});
