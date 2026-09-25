import { describe, expect, it } from 'vitest';

import { buildAgentProfile } from '@/testing/factories/agent-profile.factory.ts';
import { buildStablePromptInput } from '@/testing/factories/stable-prompt-input.factory.ts';

import { renderContextBudgetPreamble } from '../context-budget.preamble.ts';

const PROFILE = buildAgentProfile({ contextBudgetTokens: 12_000, turnContextCeilingTokens: 32_000 });

describe('renderContextBudgetPreamble', () => {
  it('should state the configured window budget and turn ceiling (§3.8)', () => {
    const paragraph = renderContextBudgetPreamble(buildStablePromptInput({ profile: PROFILE }));
    expect(paragraph).toContain('fits the recent posts and records in this channel to about 12000 tokens');
    expect(paragraph).toContain('The whole of your context in one turn is kept under about 32,000 tokens.');
  });

  it('should state the view a long result arrives in, from the turn ceiling, and how to read on (§3.8)', () => {
    const paragraph = renderContextBudgetPreamble(buildStablePromptInput({ profile: PROFILE }));
    expect(paragraph).toContain('A result longer than about 19,200 characters');
    expect(paragraph).toContain('results__read reads on from an offset or finds phrases in it');
    expect(paragraph).toContain('shown as one line with its reference and the time it was recorded');
  });
});
