import { describe, expect, it } from 'vitest';

import { buildStablePromptInput } from '@/testing/factories/stable-prompt-input.factory.ts';

import { renderRepliesPreamble } from '../replies.preamble.ts';

describe('renderRepliesPreamble', () => {
  it('should say a reply reaching nobody goes back once only to an agent that reports on units (§3.15)', () => {
    const reporting = buildStablePromptInput({ granted: [{ gates: false, id: ['tasks', 'report'] }] });
    expect(renderRepliesPreamble(reporting)).toContain('the same reply sent again is posted');
    expect(renderRepliesPreamble(buildStablePromptInput())).not.toContain('Once in a turn');
  });

  it('should allow an empty ending after a unit post only to an agent that assigns or reports (§3.15)', () => {
    const exception = 'except an empty ending after a unit post of yours has handed work to a colleague';
    const assigning = buildStablePromptInput({ granted: [{ gates: false, id: ['tasks', 'assign'] }] });
    expect(renderRepliesPreamble(assigning)).toContain(exception);
    expect(renderRepliesPreamble(buildStablePromptInput())).not.toContain(exception);
  });
});
