import { PERSONALITY_PROMPTS } from '@/agents/personalities/personalities.constants.ts';

import type { StablePromptInput } from '../prompt.types.ts';

export function renderPersonalitySection({ profile, textFormatter }: StablePromptInput): string | undefined {
  if (profile.personality === undefined) {
    return undefined;
  }
  return textFormatter.formatParagraphs(
    ['## Personality', 'The stance you take here:', ...PERSONALITY_PROMPTS[profile.personality]],
    {}
  );
}
