import { describe, expect, it } from 'vitest';

import { refuseUnbrowsableUrl } from '../web.policy.ts';

describe('refuseUnbrowsableUrl', () => {
  it('should admit a public https page', () => {
    expect(refuseUnbrowsableUrl('https://northmoor.example/people/')).toBeUndefined();
  });

  it.each(['file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,hi', 'not a url'])(
    'should refuse %s as a scheme this instrument does not read',
    (url) => {
      expect(refuseUnbrowsableUrl(url)).toStrictEqual({ kind: 'url-refused', reason: 'not-web-scheme', url });
    }
  );

  it.each([
    'http://localhost:9200/_search',
    'http://127.0.0.1:8080/',
    'http://169.254.169.254/latest/meta-data/',
    'http://10.0.0.5/',
    'http://192.168.1.1/',
    'http://172.16.0.1/',
    'http://[::1]:3000/'
  ])('should refuse %s as an address off the public web', (url) => {
    expect(refuseUnbrowsableUrl(url)).toStrictEqual({ kind: 'url-refused', reason: 'not-public-host', url });
  });

  it('should admit a public address that merely resembles a private one', () => {
    expect(refuseUnbrowsableUrl('http://172.32.0.1/')).toBeUndefined();
  });
});
