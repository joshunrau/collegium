import { describe, expect, it } from 'vitest';

import { buildStablePromptInput } from '@/testing/factories/stable-prompt-input.factory.ts';

import { renderRepliesPreamble } from '../replies.preamble.ts';

describe('renderRepliesPreamble', () => {
  it('should say a reply reaching nobody goes back once only to an agent that reports on units (§3.15)', () => {
    const reporting = buildStablePromptInput({ granted: [{ gates: false, id: ['tasks', 'report'] }] });
    expect(renderRepliesPreamble(reporting)).toContain('the same reply sent again is posted');
    expect(renderRepliesPreamble(buildStablePromptInput())).not.toContain('Once in a turn');
  });
});
