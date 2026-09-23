import { describe, expect, it } from 'vitest';

import { buildStablePromptInput } from '@/testing/factories/stable-prompt-input.factory.ts';

import { renderEarlierActionsPreamble } from '../earlier-actions.preamble.ts';

describe('renderEarlierActionsPreamble', () => {
  it('should state how many earlier action lines the tail carries (§3.8)', () => {
    expect(renderEarlierActionsPreamble(buildStablePromptInput())).toContain('at most 20 of them, newest first');
  });
});
