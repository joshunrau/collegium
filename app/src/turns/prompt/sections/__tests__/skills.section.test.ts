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

Procedures written for situations you will meet here. A skill loaded with skills__load lasts only this turn; a later turn sees one line saying it was loaded. Before starting work that one of these descriptions matches, load that skill, even if an earlier turn loaded it:

- handing-work-to-a-peer: How to hand work over.`);
  });
});
