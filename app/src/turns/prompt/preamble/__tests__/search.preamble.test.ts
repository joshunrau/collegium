import { describe, expect, it } from 'vitest';

import { buildStablePromptInput } from '@/testing/factories/stable-prompt-input.factory.ts';

import { renderSearchPreamble } from '../search.preamble.ts';

describe('renderSearchPreamble', () => {
  it('should state what conversations__search reaches only for an agent that holds it (§3.8)', () => {
    expect(renderSearchPreamble(buildStablePromptInput())).toBeUndefined();
    expect(
      renderSearchPreamble(buildStablePromptInput({ granted: [{ gates: false, id: ['conversations', 'search'] }] }))
    ).toContain('conversations__search finds past posts in the channels you are in.');
  });
});
