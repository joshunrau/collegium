import { describe, expect, it } from 'vitest';

import { cloakEmail } from '@/testing/factories/cloudflare.factory.ts';

import { decodeCloudflareEmail } from '../cloudflare.utils.ts';

describe('decodeCloudflareEmail', () => {
  it('should decode a cloaked address as the decoder script would', () => {
    expect(decodeCloudflareEmail(cloakEmail('duval@northmoor.example'))).toBe('duval@northmoor.example');
  });

  it.each([
    ['an odd-length cipher', cloakEmail('duval@northmoor.example').slice(0, -1)],
    ['a cipher that is not hex', 'zz'.repeat(8)],
    ['a cipher that decodes to no address', cloakEmail('not an address')]
  ])('should refuse %s rather than guess', (_name, hex) => {
    expect(decodeCloudflareEmail(hex)).toBeUndefined();
  });
});
