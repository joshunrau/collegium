import type { StablePromptInput } from '../prompt.types.ts';

export function renderSkillsSection({ skillsManifest, textFormatter }: StablePromptInput): string | undefined {
  if (skillsManifest === '') {
    return undefined;
  }
  return textFormatter.formatParagraphs(
    [
      '## Skills',
      'Procedures written for situations you will meet here. A skill loaded with skills__load lasts only this turn; a later turn sees one line saying it was loaded. Before starting work that one of these descriptions matches, load that skill, even if an earlier turn loaded it:',
      '{manifest}'
    ],
    { manifest: skillsManifest }
  );
}
