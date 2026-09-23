import { describe, expect, it } from 'vitest';

import { buildStablePromptInput } from '@/testing/factories/stable-prompt-input.factory.ts';

import { renderWorkUnitsPreamble } from '../work-units.preamble.ts';

describe('renderWorkUnitsPreamble', () => {
  it('should describe the Open work section and its absence only for an agent holding a tasks tool (§3.15)', () => {
    expect(renderWorkUnitsPreamble(buildStablePromptInput())).toBeUndefined();
    expect(
      renderWorkUnitsPreamble(buildStablePromptInput({ granted: [{ gates: false, id: ['tasks', 'read'] }] }))
    ).toContain(
      'listed under Open work with their references, oldest first, and that section says so when none is open'
    );
  });
});
