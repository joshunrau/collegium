import { BUILTINS_TOOLSET_DEF, implementToolset } from '@collegium/core/toolsets';
import { Result } from '@collegium/core/utils';
import { z } from 'zod';

import { CLOCK_SERVICE_TOKEN } from './builtins.tokens.ts';

/** core (§8): the framework's own small tools, in every agent's set and never granted — one namespace rather than a module each */
export const BUILTINS_TOOLSET = implementToolset(BUILTINS_TOOLSET_DEF, {
  services: { clock: CLOCK_SERVICE_TOKEN },
  tools: {
    now: {
      budgetExempt: true,
      concurrent: true,
      description:
        "Get the current date and time, to the second, in the operator's timezone. Your context states the date this turn started on, never the time; this is the only source of the time.",
      execute: (_args, context) => Result.ok({ text: context.clock.now() }),
      parameters: z.object({}),
      retryable: true
    }
  }
});
