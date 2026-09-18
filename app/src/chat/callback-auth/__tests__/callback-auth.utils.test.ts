import { describe, expect, it } from 'vitest';

import { constantTimeEquals, signCallback, verifyCallback } from '../callback-auth.utils.ts';

const SECRET = 'a'.repeat(32);

describe('signCallback', () => {
  it('should sign the same parts the same way and different orders differently (§6.4)', () => {
    expect(signCallback(SECRET, ['decision', 'approval-1', 'approve'])).toBe(
      signCallback(SECRET, ['decision', 'approval-1', 'approve'])
    );
    expect(signCallback(SECRET, ['approve', 'approval-1', 'decision'])).not.toBe(
      signCallback(SECRET, ['decision', 'approval-1', 'approve'])
    );
  });
});

describe('verifyCallback', () => {
  const signature = signCallback(SECRET, ['decision', 'approval-1', 'approve']);

  it('should accept its own signature and refuse one minted for another approval, action or key (§6.4)', () => {
    expect(verifyCallback(SECRET, ['decision', 'approval-1', 'approve'], signature)).toBe(true);
    expect(verifyCallback(SECRET, ['decision', 'approval-2', 'approve'], signature)).toBe(false);
    expect(verifyCallback(SECRET, ['decision', 'approval-1', 'deny'], signature)).toBe(false);
    expect(verifyCallback('b'.repeat(32), ['decision', 'approval-1', 'approve'], signature)).toBe(false);
  });
});

describe('constantTimeEquals', () => {
  it('should compare strings of different lengths without throwing', () => {
    expect(constantTimeEquals('short', 'a much longer string')).toBe(false);
    expect(constantTimeEquals('same', 'same')).toBe(true);
  });
});
