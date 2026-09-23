import { describe, expect, it } from 'vitest';

import { buildAgentProfile } from '@/testing/factories/agent-profile.factory.ts';
import { buildStablePromptInput } from '@/testing/factories/stable-prompt-input.factory.ts';

import { renderPersonalitySection } from '../personality.section.ts';

describe('renderPersonalitySection', () => {
  it('should render nothing for an agent with no personality', () => {
    expect(renderPersonalitySection(buildStablePromptInput())).toBeUndefined();
  });

  it('should state the stance under its own heading', () => {
    const section = renderPersonalitySection(
      buildStablePromptInput({ profile: buildAgentProfile({ personality: 'candid' }) })
    );
    expect(section).toContain('## Personality\n\nThe stance you take here:\n\n');
    expect(section).toContain('Never apologize for disagreeing.');
  });
});
