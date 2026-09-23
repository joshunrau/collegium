import { TextFormatter } from '@/formatting/text/text.formatter.ts';
import type { StablePromptInput } from '@/turns/prompt/prompt.types.ts';

import { buildAgentProfile } from './agent-profile.factory.ts';

export function buildStablePromptInput(overrides: Partial<StablePromptInput> = {}): StablePromptInput {
  return {
    budgetExemptCalls: [],
    foldLimit: 3,
    granted: [],
    mailbox: undefined,
    presentCommands: [],
    profile: buildAgentProfile(),
    skillsManifest: '',
    supersedableCalls: [],
    textFormatter: new TextFormatter(),
    ...overrides
  };
}
