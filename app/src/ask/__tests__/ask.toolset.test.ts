import { describe, expect, it } from 'vitest';

import { ASK_TOOLSET } from '../ask.toolset.ts';

describe('ASK_TOOLSET', () => {
  it('should state the options cap in its prose, since a rejected call costs a budget attempt (§3.7a)', () => {
    const { human } = ASK_TOOLSET.tools;
    expect(human.description).toContain('two to six short answers as buttons');
    expect(human.parameters.safeParse({ options: ['a', 'b', 'c', 'd', 'e', 'f'], question: 'which?' }).success).toBe(
      true
    );
    expect(
      human.parameters.safeParse({ options: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], question: 'which?' }).success
    ).toBe(false);
  });
});
