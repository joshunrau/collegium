import { defineToolset } from '@collegium/core/toolsets';
import { Result } from '@collegium/core/utils';
import { z } from 'zod';

import { $MemorySettings } from './memory.schemas.ts';
import { MEMORY_SERVICE_TOKEN } from './memory.tokens.ts';

export const MEMORY_TOOLSET = defineToolset({
  name: 'memory',
  services: { memory: MEMORY_SERVICE_TOKEN },
  settings: $MemorySettings,
  tools: {
    read: {
      budgetExempt: true,
      description: 'Read the full body of one of your memories.',
      execute: async (args, context) => {
        const memory = await context.memory.read(context.turn.agentUsername, args.id);
        if (!memory.success) {
          return Result.err({
            kind: 'invalid-arguments',
            message: `no memory entry with id "${memory.error.id}" exists`
          });
        }
        return Result.ok({ text: memory.value.body });
      },
      parameters: z.object({
        id: z.string().min(1).describe('The id of the memory entry, as listed beside its description')
      }),
      retryable: true,
      traceDetail: (args) => args.id
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
            reference: written.value.entry.id,
            supersededDescriptions: written.value.evictedDescriptions
          },
          text: `memory ${written.value.entry.id} saved`
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
