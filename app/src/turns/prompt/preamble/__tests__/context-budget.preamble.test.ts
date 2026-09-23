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

  it('should state the retention rule for the calls whose results fold, from the turn ceiling (§3.8)', () => {
    const paragraph = renderContextBudgetPreamble(
      buildStablePromptInput({ profile: PROFILE, supersedableCalls: ['web__fetch', 'workspace__read'] })
    );
    expect(paragraph).toContain(
      'results of web__fetch and workspace__read are kept word for word up to about 10,000 tokens of them and never fewer than the 2 most recent'
    );
    expect(paragraph).toContain('Text you write yourself is never replaced.');
    expect(paragraph).not.toContain("Each tool result in a turn stays in that turn's context.");
  });

  it('should say every result stays for an agent holding no tool whose results fold (§3.8)', () => {
    expect(renderContextBudgetPreamble(buildStablePromptInput({ profile: PROFILE }))).toContain(
      "Each tool result in a turn stays in that turn's context."
    );
  });
});
