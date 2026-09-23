import { describe, expect, it } from 'vitest';

import { buildStablePromptInput } from '@/testing/factories/stable-prompt-input.factory.ts';

import { renderMemoryPreamble } from '../memory.preamble.ts';

describe('renderMemoryPreamble', () => {
  it('should render only for an agent that holds memory (§3.8)', () => {
    expect(renderMemoryPreamble(buildStablePromptInput())).toBeUndefined();
    const paragraph = renderMemoryPreamble(
      buildStablePromptInput({ granted: [{ gates: false, id: ['memory', 'write'] }] })
    );
    expect(paragraph).toContain('Your memories go with you between channels');
    expect(paragraph).toContain('The text of a memory is not posted in the channel.');
  });
});
