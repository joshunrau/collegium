import { describe, expect, it } from 'vitest';

import { buildStablePromptInput } from '@/testing/factories/stable-prompt-input.factory.ts';

import { renderAskPreamble } from '../ask.preamble.ts';

describe('renderAskPreamble', () => {
  it('should describe ask__human only for an agent that holds it, leaving what its description says to it (§3.7a)', () => {
    expect(renderAskPreamble(buildStablePromptInput())).toBeUndefined();
    const paragraph = renderAskPreamble(buildStablePromptInput({ granted: [{ gates: false, id: ['ask', 'human'] }] }));
    expect(paragraph).toContain('ask__human waits with no timeout for one person in this channel to answer');
    expect(paragraph).not.toContain('two to six short answers');
  });
});
