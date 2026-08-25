import { implementToolset, SKILLS_TOOLSET_DEF } from '@collegium/core/toolsets';
import { Result } from '@collegium/core/utils';
import { z } from 'zod';

import { SKILLS_SERVICE_TOKEN } from './skills.tokens.ts';

/** core (§8): in every agent's tool set and never granted — loading a skill the agent was already assigned */
export const SKILLS_TOOLSET = implementToolset(SKILLS_TOOLSET_DEF, {
  services: { skills: SKILLS_SERVICE_TOKEN },
  tools: {
    load: {
      budgetExempt: true,
      description: 'Load the full body of a skill from your skill manifest into the conversation.',
      execute: (args, context) => {
        const document = context.skills.getDocument(args.name);
        if (!document.success) {
          return Result.err({ kind: 'invalid-arguments', message: document.error.message });
        }
        return Result.ok({ text: document.value });
      },
      parameters: z.object({
        name: z.string().min(1).describe('The name of the skill, exactly as it appears in your skill manifest')
      }),
      retryable: true,
      traceDetail: (args) => args.name
    }
  }
});
