import { describe, expect, it } from 'vitest';

import { isPrivateAddress, refusesCallbacks } from '../mattermost-admin.utils.ts';

describe('isPrivateAddress', () => {
  it('should hold loopback, private, and link-local addresses private', () => {
    expect(['127.0.0.1', '10.1.2.3', '172.20.0.5', '192.168.1.4', '169.254.1.1', '::1'].map(isPrivateAddress)).toEqual(
      Array(6).fill(true)
    );
  });

  it('should hold a routable address public', () => {
    expect(['8.8.8.8', '172.32.0.1', '2606:4700::1111'].map(isPrivateAddress)).toEqual([false, false, false]);
  });
});

describe('refusesCallbacks', () => {
  it('should accept a host the server allows', async () => {
    await expect(refusesCallbacks({ allowed: ['app'], publicUrl: 'http://app:3000' })).resolves.toBe(false);
  });

  it('should accept a host a wildcard entry covers', async () => {
    const allowed = ['*.internal.example.org'];
    await expect(refusesCallbacks({ allowed, publicUrl: 'https://collegium.internal.example.org' })).resolves.toBe(
      false
    );
  });

  it('should refuse an unlisted private address', async () => {
    await expect(refusesCallbacks({ allowed: [], publicUrl: 'http://127.0.0.1:3000' })).resolves.toBe(true);
  });

  it('should accept an unlisted public address, which the server never consults its list for', async () => {
    await expect(refusesCallbacks({ allowed: [], publicUrl: 'http://8.8.8.8:3000' })).resolves.toBe(false);
  });
});
