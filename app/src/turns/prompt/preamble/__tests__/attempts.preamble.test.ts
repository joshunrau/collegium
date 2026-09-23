import { describe, expect, it } from 'vitest';

import { buildAgentProfile } from '@/testing/factories/agent-profile.factory.ts';
import { buildStablePromptInput } from '@/testing/factories/stable-prompt-input.factory.ts';

import { renderAttemptsPreamble } from '../attempts.preamble.ts';

describe('renderAttemptsPreamble', () => {
  it('should state the configured budget and the calls exempt from it', () => {
    const paragraph = renderAttemptsPreamble(
      buildStablePromptInput({
        budgetExemptCalls: ['builtins__now', 'skills__load'],
        profile: buildAgentProfile({ actionBudget: 7 })
      })
    );
    expect(paragraph).toContain('Each turn has 7 attempts.');
    expect(paragraph).toContain('Calls to builtins__now and skills__load spend none.');
  });
});
