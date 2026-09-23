import { implementToolset, TRIGGERS_TOOLSET_DEF } from '@collegium/core/toolsets';
import { Result } from '@collegium/core/utils';
import { z } from 'zod';

import { TRIGGERS_SERVICE_TOKEN } from './triggers.tokens.ts';

import type { TriggerFailure } from './triggers.types.ts';

/** enough ids to pick from, never a flood of them when a channel's triggers go unresolved */
const LISTED_OUTSTANDING_IDS = 20;

/** §4.2 — a miss names what the agent has outstanding here, and never suggests the trigger is somebody else's */
function renderUnmatched({ outstandingIds, triggerId }: TriggerFailure.Unmatched): string {
  const miss =
    triggerId === undefined
      ? 'This turn was not started by a trigger of yours, so name one by its id.'
      : `"${triggerId}" is not a trigger id of yours: a trigger's id is the one its announcement brackets, never the sender's reference.`;
  if (outstandingIds.length === 0) {
    return `${miss} You have no outstanding trigger in this channel.`;
  }
  const unlisted = outstandingIds.length - LISTED_OUTSTANDING_IDS;
  const listed = outstandingIds.slice(0, LISTED_OUTSTANDING_IDS).join(', ');
  return `${miss} Outstanding for you in this channel: ${listed}${unlisted > 0 ? `, and ${unlisted} more` : ''}.`;
}

/** core (§8): in every agent's tool set and never granted — clearing a trigger the framework itself raised */
export const TRIGGERS_TOOLSET = implementToolset(TRIGGERS_TOOLSET_DEF, {
  services: { triggers: TRIGGERS_SERVICE_TOKEN },
  tools: {
    resolve: {
      description: 'Mark a trigger as handled so its outstanding list entry is closed.',
      execute: async (args, context) => {
        const resolved = await context.triggers.resolve({ ...context.turn, triggerId: args.id });
        if (!resolved.success) {
          const message =
            resolved.error.kind === 'not-resolvable' ? resolved.error.message : renderUnmatched(resolved.error);
          return Result.err({ kind: 'invalid-arguments', message });
        }
        return Result.ok({ text: `trigger ${resolved.value.triggerId} resolved` });
      },
      parameters: z.object({
        id: z
          .string()
          .min(1)
          .optional()
          .describe(
            'The trigger’s id, the one bracketed in its announcement. Omit it to resolve the trigger whose announcement started this turn'
          )
      }),
      /** resolving is idempotent, so a transport-level retry cannot double a side effect (§7.2) */
      retryable: true,
      traceDetail: (args) => args.id ?? 'the trigger that started this turn'
    }
  }
});
