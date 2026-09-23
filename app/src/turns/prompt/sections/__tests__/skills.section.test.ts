import { describe, expect, it } from 'vitest';

import { buildStablePromptInput } from '@/testing/factories/stable-prompt-input.factory.ts';

import { renderSkillsSection } from '../skills.section.ts';

describe('renderSkillsSection', () => {
  it('should render nothing for an agent granted no skill', () => {
    expect(renderSkillsSection(buildStablePromptInput())).toBeUndefined();
  });

  it('should list the manifest under the load instruction', () => {
    expect(
      renderSkillsSection(
        buildStablePromptInput({ skillsManifest: '- handing-work-to-a-peer: How to hand work over.' })
      )
    ).toBe(`## Skills

Procedures written for situations you will meet here. Load one with skills__load before acting when the work in front of you is the situation its description names; a load you did not need still costs a round trip:

- handing-work-to-a-peer: How to hand work over.`);
  });
});
