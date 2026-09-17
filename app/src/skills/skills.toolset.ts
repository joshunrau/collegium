import { implementToolset, SKILLS_TOOLSET_DEF } from '@collegium/core/toolsets';
import { Result } from '@collegium/core/utils';
import { z } from 'zod';

import { SKILLS_SERVICE_TOKEN } from './skills.tokens.ts';

/** the skill and its reference read as the path they are on disk, in the status post and the replay line alike */
const renderPath = (name: string, reference: string | undefined): string => {
  return reference === undefined ? name : `${name}/${reference}`;
};

/** core (§3.4): in every agent's tool set and never granted — loading a skill the agent was already assigned */
export const SKILLS_TOOLSET = implementToolset(SKILLS_TOOLSET_DEF, {
  services: { skills: SKILLS_SERVICE_TOKEN },
  tools: {
    load: {
      budgetExempt: true,
      concurrent: true,
      description:
        'Load the full body of a skill from your skill manifest into the conversation, or one of the reference documents that skill lists.',
      execute: (args, context) => {
        const document = context.skills.getDocument(context.turn.agentUsername, args.name, args.reference);
        if (!document.success) {
          return Result.err({ kind: 'invalid-arguments', message: document.error.message });
        }
        // the agent loads a skill every turn it needs one, so an earlier load replays as a line
        const subject = args.reference === undefined ? 'skill' : 'reference';
        return Result.ok({
          replay: `[loaded ${subject} ${renderPath(args.name, args.reference)}]`,
          text: document.value
        });
      },
      parameters: z.object({
        name: z.string().min(1).describe('The name of the skill, exactly as it appears in your skill manifest'),
        reference: z
          .string()
          .min(1)
          .optional()
          .describe(
            'A supporting document listed under "## References" in that skill, by its name there. Omit to load the skill itself.'
          )
      }),
      retryable: true,
      traceDetail: (args) => renderPath(args.name, args.reference)
    }
  }
});
