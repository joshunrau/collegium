import { describe, expect, it } from 'vitest';

import { buildStablePromptInput } from '@/testing/factories/stable-prompt-input.factory.ts';

import { renderMemoryBaseline } from '../memory.baseline.ts';

describe('renderMemoryBaseline', () => {
  it('should render only for an agent that holds memory (§3.8)', () => {
    expect(renderMemoryBaseline(buildStablePromptInput())).toBeUndefined();
    expect(
      renderMemoryBaseline(buildStablePromptInput({ granted: [{ gates: false, id: ['memory', 'write'] }] }))
    ).toContain('Memory is for what a later turn will need and cannot look up');
  });
});
