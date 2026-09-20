import type { LookupAddress } from 'node:dns';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createAddressPolicy, isBlockedAddress, refuseUnbrowsableUrl, resolveAndVetHost } from '../web.policy.ts';

const lookupMock = vi.hoisted(() => vi.fn<(hostname: string, options: { all: true }) => Promise<LookupAddress[]>>());

vi.mock('node:dns/promises', () => ({ lookup: lookupMock }));

beforeEach(() => {
  lookupMock.mockReset();
});

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
    'http://100.64.0.1/',
    'http://[::1]:3000/',
    'http://[::ffff:127.0.0.1]/',
    'http://[64:ff9b::7f00:1]/',
    'http://[ff02::1]/'
  ])('should refuse %s as an address off the public web', (url) => {
    expect(refuseUnbrowsableUrl(url)).toStrictEqual({ kind: 'url-refused', reason: 'not-public-host', url });
  });

  it.each(['http://172.32.0.1/', 'https://0.gravatar.com/avatar/', 'https://10.example.com/'])(
    'should admit %s, which merely resembles a private address',
    (url) => {
      expect(refuseUnbrowsableUrl(url)).toBeUndefined();
    }
  );
});

describe('isBlockedAddress', () => {
  it.each([
    '100.64.0.1',
    '100.127.255.255',
    '224.0.0.1',
    '240.0.0.1',
    '255.255.255.255',
    'fd12::1',
    '[::1]',
    '::ffff:127.0.0.1',
    '64:ff9b::a00:5',
    '64:ff9b:1::808:808',
    'ff02::1'
  ])('should block %s', (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each(['100.63.255.255', '100.128.0.0', '203.0.113.7', '2606:4700::1', '::ffff:8.8.8.8', '64:ff9b::808:808'])(
    'should admit %s',
    (address) => {
      expect(isBlockedAddress(address)).toBe(false);
    }
  );
});

describe('resolveAndVetHost', () => {
  const url = new URL('https://northmoor.example/people/');

  it('should hand back the first IPv4 answer of a name every answer of which is public', async () => {
    lookupMock.mockResolvedValueOnce([
      { address: '2606:4700::1', family: 6 },
      { address: '203.0.113.7', family: 4 }
    ]);
    expect((await resolveAndVetHost(url)).value).toStrictEqual({ address: '203.0.113.7', family: 4 });
  });

  it('should refuse a name carrying a private answer beside a public one (§3.4)', async () => {
    lookupMock.mockResolvedValueOnce([
      { address: '203.0.113.7', family: 4 },
      { address: '10.0.0.5', family: 4 }
    ]);
    expect((await resolveAndVetHost(url)).error).toStrictEqual({
      kind: 'url-refused',
      reason: 'not-public-host',
      url: url.href
    });
  });

  it('should report a name that does not resolve as the page not loading', async () => {
    lookupMock.mockRejectedValueOnce(new Error('getaddrinfo ENOTFOUND northmoor.example'));
    expect((await resolveAndVetHost(url)).error).toStrictEqual({
      kind: 'navigation',
      message: 'getaddrinfo ENOTFOUND northmoor.example'
    });
  });
});

describe('createAddressPolicy', () => {
  it('should refuse a loopback literal and a privately resolving name unless the deployment declared its network browsable (§3.4)', async () => {
    const strict = createAddressPolicy({ allowPrivateAddresses: false });
    const open = createAddressPolicy({ allowPrivateAddresses: true });
    expect(strict.refuse('http://127.0.0.1:8080/')?.reason).toBe('not-public-host');
    expect(open.refuse('http://127.0.0.1:8080/')).toBeUndefined();
    lookupMock.mockResolvedValue([{ address: '172.18.0.4', family: 4 }]);
    expect((await strict.resolve(new URL('http://fixtures/'))).error).toMatchObject({ reason: 'not-public-host' });
    expect((await open.resolve(new URL('http://fixtures/'))).value).toStrictEqual({ address: '172.18.0.4', family: 4 });
    expect(await open.vet(new URL('http://fixtures/'))).toStrictEqual({ address: '172.18.0.4', family: 4 });
  });

  it('should keep the scheme rule with the network declared browsable', () => {
    const open = createAddressPolicy({ allowPrivateAddresses: true });
    expect(open.refuse('file:///etc/passwd')?.reason).toBe('not-web-scheme');
  });
});
