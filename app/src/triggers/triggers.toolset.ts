import { defineToolset } from '@collegium/core/toolsets';
import { Result } from '@collegium/core/utils';
import { z } from 'zod';

import { TRIGGERS_SERVICE_TOKEN } from './triggers.tokens.ts';

/** core (§8): in every agent's tool set and never granted — clearing a trigger the framework itself raised */
export const TRIGGERS_TOOLSET = defineToolset({
  name: 'triggers',
  services: { triggers: TRIGGERS_SERVICE_TOKEN },
  tools: {
    resolve: {
      description: 'Mark a trigger as handled so its outstanding list entry is closed.',
      execute: async (args, context) => {
        const resolved = await context.triggers.resolve(args.id, context.turn.agentUsername);
        if (!resolved.success) {
          // the source's own handling failed, which the agent can act on — unlike an unknown id
          if (resolved.error.kind === 'not-resolvable') {
            return Result.err({ kind: 'invalid-arguments', message: resolved.error.message });
          }
          return Result.err({ kind: 'invalid-arguments', message: `no trigger "${args.id}" is addressed to you` });
        }
        return Result.ok({ text: `trigger ${args.id} resolved` });
      },
      parameters: z.object({
        id: z.string().min(1).describe('The trigger id, exactly as it appears in the announcement post')
      }),
      /** resolving is idempotent, so a transport-level retry cannot double a side effect (§7.2) */
      retryable: true,
      traceDetail: (args) => args.id
    }
  }
});
