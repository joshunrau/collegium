import type { StablePromptInput } from '../prompt.types.ts';

export function renderSkillsSection({ skillsManifest, textFormatter }: StablePromptInput): string | undefined {
  if (skillsManifest === '') {
    return undefined;
  }
  return textFormatter.formatParagraphs(
    [
      '## Skills',
      'Procedures written for situations you will meet here. Load one with skills__load before acting when the work in front of you is the situation its description names; a load you did not need still costs a round trip:',
      '{manifest}'
    ],
    { manifest: skillsManifest }
  );
}
