import { implementToolset, MEMORY_TOOLSET_DEF } from '@collegium/core/toolsets';
import { Result } from '@collegium/core/utils';
import { z } from 'zod';

import { MEMORY_SERVICE_TOKEN } from './memory.tokens.ts';
import { renderUnresolvedReference } from './memory.utils.ts';

export const MEMORY_TOOLSET = implementToolset(MEMORY_TOOLSET_DEF, {
  services: { memory: MEMORY_SERVICE_TOKEN },
  tools: {
    // §3.6 — ungated for the same reason a write is; the disclosure names the description because
    // the reference the model passed resolves to nothing once the row is gone
    delete: {
      description: 'Forget one of your memories. Correct a memory by forgetting it and saving a new one.',
      execute: async (args, context) => {
        const deleted = await context.memory.delete(context.turn.agentUsername, args.reference);
        if (!deleted.success) {
          return Result.err({ kind: 'invalid-arguments', message: renderUnresolvedReference(deleted.error) });
        }
        return Result.ok({
          forgottenDescription: deleted.value.description,
          text: `memory ${args.reference} forgotten: ${deleted.value.description}`
        });
      },
      parameters: z.object({
        reference: z.string().min(1).describe('The reference of the memory entry, as listed beside its description')
      }),
      /** a repeat resolves to deleted-or-not-found, and both end states are the entry being absent */
      retryable: true,
      traceDetail: (args) => args.reference
    },
    read: {
      budgetExempt: true,
      description: 'Read the full body of one of your memories.',
      execute: async (args, context) => {
        const memory = await context.memory.read(context.turn.agentUsername, args.reference);
        if (!memory.success) {
          return Result.err({ kind: 'invalid-arguments', message: renderUnresolvedReference(memory.error) });
        }
        return Result.ok({ text: memory.value.body });
      },
      parameters: z.object({
        reference: z.string().min(1).describe('The reference of the memory entry, as listed beside its description')
      }),
      retryable: true,
      traceDetail: (args) => args.reference
    },
    // §3.6 — the single ungated write: gating memory formation would park a turn on a triviality
    write: {
      description:
        'Save a memory: a one-line description shown to you on every turn, and a body you can read back on demand.',
      execute: async (args, context) => {
        const written = await context.memory.write(
          {
            agentUsername: context.turn.agentUsername,
            body: args.body,
            description: args.description,
            originPostId: context.turn.triggeringPostId
          },
          context.settings
        );
        if (!written.success) {
          const { field, length, limit } = written.error;
          return Result.err({
            kind: 'invalid-arguments',
            message: `the ${field} is ${length} characters, over its cap of ${limit}`
          });
        }
        return Result.ok({
          disclosure: {
            body: args.body,
            description: args.description,
            reference: written.value.reference,
            supersededDescriptions: written.value.evictedDescriptions
          },
          text: `memory ${written.value.reference} saved`
        });
      },
      parameters: z.object({
        body: z.string().min(1).describe('The content to remember'),
        description: z.string().min(1).describe('One line stating when this memory matters')
      }),
      /** §3.6 already disclosed the body on its own line, so the call line carries only the description */
      traceDetail: (args) => args.description
    }
  }
});
